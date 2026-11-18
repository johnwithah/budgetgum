// ─────────────────────────────────────────────────────────────────────────────
// sw.js — the service worker. Runs in the background, separate from the page.
//
// Two jobs:
//   1. PUSH — receive notifications from /api/notify and show them, even when
//      Budgetgum is closed. Tapping one opens (or focuses) the app at the right
//      screen.
//   2. APP SHELL — cache the HTML/JS/CSS so the Home Screen app opens instantly
//      and doesn't show a blank page on a bad connection.
//
// What it deliberately does NOT cache: anything under /api/. Your budget and
// bank data never go into this cache — they come from the server each time,
// same as before.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE = 'budgetgum-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Pages: network first so a deploy shows up immediately; cached copy offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Built assets have content hashes in their names, so a cached copy is never
  // stale. Icons/manifest: serve cached, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
    if (cached) {
      if (!url.pathname.startsWith('/static/')) event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })());
});

// ── Push ─────────────────────────────────────────────────────────────────────
// iOS revokes push permission from apps that receive a push without showing a
// notification, so every push shows one — even if the payload is malformed.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Budgetgum';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      // App already running: tell it where to go rather than reloading it.
      await open.focus();
      open.postMessage({ type: 'open-url', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
