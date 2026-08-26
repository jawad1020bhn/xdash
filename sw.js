/* =============================================================================
   Service worker

   The previous worker carried a hand-maintained list of forty asset URLs with
   version query strings. It had drifted two versions behind index.html, so it
   precached files nothing requested and missed the files everything did.

   This worker has no list to maintain. At install it fetches index.html, reads
   the assets that document actually references, then walks the ES module graph
   by following each module's own import statements. The precache is therefore
   derived from the shipped files at install time and cannot go stale.

   Strategies (GET, same-origin only):
     navigations          network-first → shell cache → /offline.html
     app assets (js/css)  stale-while-revalidate
     data (*.json)        network-first, because the archive is the content
     pbs.twimg.com        stale-while-revalidate with an LRU cap
     video streams        never cached — Range requests do not survive a cache,
                          and the files are far too large to hold
   ============================================================================= */
"use strict";

const VERSION = "2.0.0";
const SHELL = `xarc-shell-${VERSION}`;
const ASSETS = `xarc-assets-${VERSION}`;
const IMAGES = `xarc-images-${VERSION}`;

const IMAGE_CACHE_LIMIT = 400;
const IMAGE_CACHE_TRIM_TO = 300;

const OFFLINE_PAGE = "./offline.html";
const START_URL = "./index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    discoverAssets()
      .then((urls) => caches.open(SHELL).then((cache) => cache.addAll(
        [...new Set([START_URL, OFFLINE_PAGE, ...urls])],
      )))
      /* A missing asset must never take the whole worker down: precache what
         we can, and let runtime caching cover the rest. */
      .catch((err) => console.info("[sw] partial precache:", err.message))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.includes(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim())
      .then(() => trimImageCache())
      .then(() => registerPersistentStorage()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* ==========================================================================
   Asset discovery
   ========================================================================== */

const isSameOrigin = (url) => {
  try { return new URL(url, self.location).origin === self.location.origin; }
  catch { return false; }
};

/** Assets referenced by index.html, plus the module graph beneath them. */
async function discoverAssets() {
  const response = await fetch(START_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not read ${START_URL}`);
  const html = await response.text();

  const urls = new Set();
  const entryPoints = [];

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = match[1];
    if (/^(data:|https?:|\/\/|#)/.test(raw)) continue;
    const url = new URL(raw, self.location);
    if (!isSameOrigin(url)) continue;
    const path = url.pathname;
    if (/\.(css|js|mjs|woff2|png|svg|webmanifest)$/.test(path)) {
      urls.add(path);
      if (/\.js$/.test(path)) entryPoints.push(path);
    }
  }

  await Promise.all(entryPoints.map((entry) => walkModuleGraph(entry, urls, new Set())));
  return [...urls];
}

/** Follows a module's static imports, one level at a time, cycles guarded. */
async function walkModuleGraph(path, urls, seen) {
  if (seen.has(path)) return;
  seen.add(path);

  let source;
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return;
    source = await response.text();
  } catch { return; }

  const imports = [];
  for (const match of source.matchAll(/(?:^|[\s;])(?:import|export)[^;]*?from\s*["']([^"']+)["']/gm)) {
    imports.push(match[1]);
  }
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    imports.push(match[1]);
  }

  await Promise.all(imports.map(async (specifier) => {
    if (!specifier.startsWith(".")) return;         // bare specifiers are not used here
    let resolved;
    try { resolved = new URL(specifier, self.location.origin + path).pathname; }
    catch { return; }
    urls.add(resolved);
    await walkModuleGraph(resolved, urls, seen);
  }));
}

/* ==========================================================================
   Fetch
   ========================================================================== */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* Video and HLS: always straight to the network. */
  if (/\.(mp4|m3u8|ts|webm)(\?|$)/.test(url.pathname) ||
      url.hostname === "video.twimg.com") return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  if (url.hostname === "pbs.twimg.com") {
    event.respondWith(cachedImage(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (/\.json(\?|$)/.test(url.pathname)) {
    event.respondWith(networkFirst(request, ASSETS));
    return;
  }
  if (/\.(js|mjs|css|woff2|png|svg|webmanifest|ico)(\?|$)/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, ASSETS));
    return;
  }
});

async function navigate(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(SHELL);
    cache.put(START_URL, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(SHELL);
    return (await cache.match(START_URL)) ||
           (await cache.match(OFFLINE_PAGE)) ||
           new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => hit);
  return hit || network;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(request)) ||
      new Response("[]", { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

async function cachedImage(request) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).then(trimImageCache);
    return response;
  }).catch(() => hit);
  return hit || network;
}

/* ==========================================================================
   Housekeeping
   ========================================================================== */

async function trimImageCache() {
  const cache = await caches.open(IMAGES);
  const keys = await cache.keys();
  if (keys.length <= IMAGE_CACHE_LIMIT) return;
  for (const key of keys.slice(0, keys.length - IMAGE_CACHE_TRIM_TO)) {
    await cache.delete(key);
  }
}

async function registerPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    const granted = await navigator.storage.persist();
    if (!granted) await navigator.storage.persist();
  } catch { /* unsupported */ }
}

/* Re-check quota periodically; an archive that grows should not silently blow
   the origin's budget. */
setInterval(async () => {
  if (!navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (quota && usage / quota > 0.8) await trimImageCache();
  } catch { /* ignore */ }
}, 1000 * 60 * 60);
