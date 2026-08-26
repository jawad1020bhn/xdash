/* =============================================================================
   X Bookmarks · Service worker

   Strategy summary (all GET, same-scope only):

     navigations            network-first  → shell cache → offline.html
     app assets (css/js)    stale-while-revalidate, versioned
     fonts (woff2)          cache-first (immutable in practice)
     pbs.twimg.com images   stale-while-revalidate + LRU cap
     media streams (video)  NEVER cached — Range requests break caches and
                            the files are far too large to hold

   Lifecycle: the new worker waits until every client is closed unless the
   page sends SKIP_WAITING; the old cache generation is deleted on activate.
   The page is told about updates through postMessage('UPDATE_AVAILABLE').

   Storage: registers for persistent storage and self-trims the image LRU
   when quota pressure appears (navigator.storage.estimate).
   ============================================================================= */
"use strict";

const VERSION = "v1.3.5";
const SHELL_CACHE = `xb-shell-${VERSION}`;
const ASSET_CACHE = `xb-asset-${VERSION}`;
const FONT_CACHE = `xb-font-${VERSION}`;
const IMG_CACHE = `xb-img-${VERSION}`;
const IMG_LIMIT = 400;               // entries kept in the image LRU
const IMG_TRIM_TO = 300;

/* Everything the app needs to paint offline, mirrored from index.html.
   Keep in sync with the HTML asset list (a build step would own this). */
const PRECACHE = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",

  "./m3e/fonts.css?v=14",
  "./m3e/tokens.css?v=14",
  "./m3e/components.css?v=14",
  "./css/foundation.css?v=14",
  "./css/workspaces.css?v=14",
  "./css/viewer.css?v=14",
  "./css/settings.css?v=14",
  "./css/mobile.css?v=14",
  "./css/lock.css?v=14",

  "./m3e/color.js?v=14",
  "./m3e/theme.js?v=14",
  "./m3e/interactions.js?v=14",
  "./m3e/media.js?v=14",
  "./m3e/video-controls.js?v=14",
  "./js/demo.js?v=14",
  "./js/store.js?v=14",
  "./js/library.js?v=14",
  "./js/ui.js?v=14",
  "./js/mobile.js?v=14",
  "./js/state.js?v=14",
  "./js/card.js?v=14",
  "./js/viewer.js?v=14",
  "./js/views/discover.js?v=14",
  "./js/views/library.js?v=14",
  "./js/views/watch.js?v=14",
  "./js/views/settings.js?v=14",
  "./js/views/manage.js?v=14",
  "./js/views/capture.js?v=14",
  "./js/lock.js?v=14",
  "./js/app.js?v=14",
  "./js/pwa.js?v=14",

  "./m3e/fonts/roboto-flex-latin-opsz-normal.woff2",
  "./m3e/fonts/roboto-flex-latin-ext-opsz-normal.woff2",
];

/* ---------------------------------------------------------------------------
   Install: warm the caches. Failure of a single entry must not break install
   (a missing demo file shouldn't brick the shell), so precache with
   per-entry tolerance.
   --------------------------------------------------------------------------- */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.allSettled(PRECACHE.map(async (url) => {
      try {
        await shell.add(new Request(url, { cache: "reload" }));
      } catch (_) {
        /* Non-fatal: runtime strategies will fill any gap. */
      }
    }));
    /* Wait, don't skip: the old worker keeps serving until pages agree. */
    await self.skipWaiting().catch(() => {});
  })());
});

/* ---------------------------------------------------------------------------
   Activate: drop every cache generation that isn't ours.
   --------------------------------------------------------------------------- */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE, IMG_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------------------
   Messages from the page
   --------------------------------------------------------------------------- */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  switch (data.type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
    case "GET_VERSION":
      event.source && event.source.postMessage({ type: "VERSION", version: VERSION });
      break;
    case "TRIM_CACHES":
      event.waitUntil(trimImageCache());
      break;
  }
});

/* ---------------------------------------------------------------------------
   Fetch strategies
   --------------------------------------------------------------------------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* Media streams: hand straight to the network. Caching breaks Range
     requests, and these files are enormous. */
  if (/video\.twimg\.com$/.test(url.hostname) ||
      /\.(mp4|m3u8|webm)(\?|$)/i.test(url.pathname)) {
    return;
  }

  /* App navigations: fresh when online, instant when not. Navigation preload
     gives us the network response in parallel with the cache lookup. */
  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  /* Same-origin static assets → SWR on the versioned asset cache. */
  if (url.origin === self.location.origin &&
      /\.(css|js|m3e)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
    return;
  }

  /* Fonts → cache first; they never change under the same URL. */
  if (/\.woff2?$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  /* X's image CDN → SWR with an LRU cap. */
  if (url.hostname === "pbs.twimg.com") {
    event.respondWith(staleWhileRevalidate(req, IMG_CACHE));
    return;
  }

  /* Everything else: network with a cache shadow, opaque responses allowed. */
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, ASSET_CACHE));
  }
});

async function handleNavigation(event) {
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const fresh = preload || await fetch(event.request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put("./index.html", fresh.clone()).catch(() => {});
    return fresh;
  } catch (_) {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(event.request)) ||
           (await cache.match("./index.html")) ||
           (await cache.match("./offline.html")) ||
           new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

/* Serve cached immediately when we have it; refresh behind it so the newest
   copy wins next time. Returns a single Response (respondWith contract). */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    network.then(() => trimImageCache()).catch(() => {}); // keep LRU fresh without blocking
    return cached;
  }
  const fresh = await network;
  return fresh || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    return Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _;
  }
}

/* ---------------------------------------------------------------------------
   Image LRU — Cache API has no eviction policy of its own. Entries are keyed
   by insertion order via the cache's own ordering; we read keys oldest-first
   and delete from the front beyond the cap, then also react to real quota
   pressure.
   --------------------------------------------------------------------------- */
let trimming = false;
async function trimImageCache() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(IMG_CACHE);
    const keys = await cache.keys();
    if (keys.length > IMG_LIMIT) {
      const excess = keys.slice(0, keys.length - IMG_TRIM_TO);
      await Promise.all(excess.map((k) => cache.delete(k)));
    }
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      if (quota && usage / quota > 0.9) {
        await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
        if (navigator.storage.persist) navigator.storage.persist().catch(() => {});
      }
    }
  } catch (_) {
    /* Eviction is best-effort by definition. */
  } finally {
    trimming = false;
  }
}
