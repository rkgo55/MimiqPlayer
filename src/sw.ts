/**
 * Custom Service Worker — Workbox precaching + COOP/COEP header injection
 *
 * GitHub Pages does not support custom HTTP response headers, so COOP/COEP
 * (required for SharedArrayBuffer / ONNX Runtime Web) must be injected here.
 *
 * Strategy:
 *   • All HTML responses get  Cross-Origin-Opener-Policy: same-origin
 *                             Cross-Origin-Embedder-Policy: require-corp
 *   • All responses get       Cross-Origin-Resource-Policy: cross-origin
 *     (so sub-resources are loadable under COEP: require-corp)
 *   • Static app-shell assets (JS/CSS/images) are pre-cached for offline use.
 *   • Large ONNX/Essentia WASM files are NOT pre-cached (handled by the app's
 *     own Cache API for model weights).
 */

import { PrecacheController, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof PrecacheController.prototype.addToCacheList>[0];
};

// ─── Precache setup ─────────────────────────────────────────────────────────

const controller = new PrecacheController();
controller.addToCacheList(self.__WB_MANIFEST ?? []);

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    controller.install({ event } as Parameters<typeof controller.install>[0])
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    cleanupOutdatedCaches()
      .then(() => controller.activate())
      .then(() => self.clients.claim()),
  );
});

// ─── COOP/COEP header injection ──────────────────────────────────────────────

/** Wrap a Response, adding COOP/COEP/CORP headers. */
function addIsolationHeaders(response: Response): Response {
  if (response.status === 0) return response; // opaque – leave as-is

  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  if (response.type === 'basic') {
    // Same-origin resource served to this page — add the isolation headers
    // needed for `crossOriginIsolated` contexts.
    // (For navigations these are most important)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  // Only handle http(s) — skip chrome-extension:// etc.
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    (async () => {
      // 1. Check precache (offline-first for app shell)
      const precached = await controller.matchRequest({
        request: event.request,
        event,
      } as Parameters<typeof controller.matchRequest>[0]);

      if (precached) {
        return addIsolationHeaders(precached);
      }

      // 2. Network fallback
      try {
        const response = await fetch(event.request);
        return addIsolationHeaders(response);
      } catch {
        // Both precache and network failed — return a generic offline response
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
