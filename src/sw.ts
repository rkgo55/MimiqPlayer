/// <reference lib="webworker" />
/**
 * Custom Service Worker — precaching
 *
 * vite-plugin-pwa injects self.__WB_MANIFEST at build time.
 * Uses the standard Cache API instead of Workbox runtime helpers.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

const MANIFEST = self.__WB_MANIFEST ?? [];
const CACHE_NAME = 'precache';

function toUrl(entry: (typeof MANIFEST)[number]): string {
  return typeof entry === 'string' ? entry : entry.url;
}

// ─── Install: populate precache ──────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Build a set of URLs that belong to the new manifest
      const urls = MANIFEST.map(toUrl);
      await cache.addAll(urls);
      await self.skipWaiting();
    }),
  );
});

// ─── Activate: clean old caches & claim clients ─────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache that isn't ours (old precache revisions, etc.)
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// ─── Fetch: cache-first for app shell, network for the rest ─────────────────

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        return await fetch(event.request);
      } catch {
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
