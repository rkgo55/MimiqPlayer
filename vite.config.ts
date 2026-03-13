import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'

// Plugin to forcibly set COOP/COEP headers after all other middleware,
// working around the issue where server.headers is overridden by Vite's CORS handler.
function crossOriginIsolationPlugin(): Plugin {
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  }
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value)
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value)
        }
        next()
      })
    },
  }
}

/**
 * Serve ORT WASM + MJS proxy files from node_modules during dev.
 * In production these files are copied via viteStaticCopy below.
 * Without this, `ort-wasm-simd-threaded.asyncify.mjs?import` returns 404
 * and both WebGPU and WASM execution providers fail to initialise.
 */
function ortAssetsDevPlugin(): Plugin {
  const ortDist = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist')
  const MIME: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.mjs':  'text/javascript',
    '.js':   'text/javascript',
  }
  return {
    name: 'ort-assets-dev',
    apply: 'serve', // dev-server only
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        // Strip base path prefix and query string
        const bare = url.replace(/^\/?mimi-copy\//, '').split('?')[0]
        const ext  = path.extname(bare)
        if (bare.startsWith('ort-') && ext in MIME) {
          const file = path.join(ortDist, bare)
          if (fs.existsSync(file)) {
            res.setHeader('Content-Type', MIME[ext])
            // COOP/COEP already set by crossOriginIsolationPlugin
            fs.createReadStream(file).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    crossOriginIsolationPlugin(),
    ortAssetsDevPlugin(),
    // Copy ONNX Runtime Web WASM + MJS proxy files to dist/ root for production.
    // The JSEP variant (*.jsep.wasm) is required for the WebGPU execution provider.
    // The *.mjs files are JS proxy loaders required by ORT 1.20+ for async init.
    viteStaticCopy({
      targets: [
        { src: 'node_modules/onnxruntime-web/dist/*.wasm', dest: '.' },
        { src: 'node_modules/onnxruntime-web/dist/*.mjs',  dest: '.' },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Use custom SW (src/sw.ts) to handle both offline caching AND COOP/COEP
      // header injection (required on GitHub Pages where server headers can't be set).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // Pre-cache app shell (JS/CSS/HTML/images).
        // Exclude large ONNX / Essentia WASM blobs — they're hundreds of MB
        // and the app already caches the model separately via Cache API.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        globIgnores: ['**/ort-*', '**/essentia-*'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
      manifest: {
        name: 'MimiqPlayer',
        short_name: 'MimiqPlayer',
        description: '耳コピ支援ツール',
        theme_color: '#141008',
        background_color: '#141008',
        display: 'standalone',
        orientation: 'any',
        start_url: '/mimi-copy/',
        scope: '/mimi-copy/',
        icons: [
          { src: 'logo-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'logo.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      devOptions: {
        enabled: false, // SW は開発中無効（HMR との干渉防止）
      },
    }),
  ],
  base: '/mimi-copy/',
  optimizeDeps: {
    // Prevent Vite from pre-bundling onnxruntime-web; it ships its own ESM
    // entry points and dynamic WASM loading that Vite's bundler would break.
    exclude: ['onnxruntime-web'],
  },
})
