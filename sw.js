'use strict';

// Only the main app document is managed here. Grades stay in localStorage.
const APP_ROOT = new URL('./', self.location.href);
const APP_PAGE = new URL('index.html', APP_ROOT).href;
const CACHE_NAME = 'notenkompass.pages.v1:' + APP_ROOT.pathname;

function isAppPage(url) {
  return url.origin === APP_ROOT.origin &&
    (url.pathname === APP_ROOT.pathname || url.pathname === new URL(APP_PAGE).pathname);
}

function isAppHtml(html) {
  return /<meta\b[^>]*\bname=["']notenkompass-build["']/i.test(html) &&
    html.includes('const TEMPLATES=');
}

function pageResponse(html) {
  return new Response(html, {
    headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}
  });
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('message', event => {
  if (!['NK_STORE_PAGE', 'NK_SEED_PAGE'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      const client = event.source && await self.clients.get(event.source.id);
      if (!client || !isAppPage(new URL(client.url)) ||
          !isAppPage(new URL(event.data.url)) ||
          typeof event.data.html !== 'string' || !isAppHtml(event.data.html)) {
        throw Error('Invalid app document');
      }
      const cache = await caches.open(CACHE_NAME);
      // A stale open tab must never replace a previously installed update.
      if (event.data.type === 'NK_STORE_PAGE' || !await cache.match(APP_PAGE)) {
        await cache.put(APP_PAGE, pageResponse(event.data.html));
      }
      event.ports[0]?.postMessage({ok: true});
    } catch {
      event.ports[0]?.postMessage({ok: false});
    }
  })());
});

async function loadApp(request) {
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = new URL(request.url);
    url.searchParams.set('_nk_refresh', Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    const response = await fetch(url.href, {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal
    });
    if (!response.ok || !isAppPage(new URL(response.url))) throw Error('Download failed');
    const html = await response.text();
    if (!isAppHtml(html)) throw Error('Invalid app document');
    const page = pageResponse(html);
    // A full cache must not stop an otherwise valid online launch.
    try { await cache?.put(APP_PAGE, page.clone()); } catch {}
    return page;
  } catch {
    const installed = await cache?.match(APP_PAGE);
    if (installed) return installed;
    throw Error('Notenkompass is unavailable offline');
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.mode === 'navigate' &&
      isAppPage(new URL(event.request.url))) {
    event.respondWith(loadApp(event.request));
  }
});
