// =============================================================================
// vite.config — build, dev and the offline story.
//
// Slice 0 replaced the hand-maintained service worker (which precached a stale
// file list) with a generated one: Workbox precaches exactly the hashed assets
// this build emitted, so the drift class is gone. Runtime strategies mirror the
// old worker's intent — app shell precached, archive data network-first, CDN
// images cached with an LRU cap, video streams never cached.
//
// base "./" keeps the app hostable under any subpath, like before.
// =============================================================================

import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  publicDir: "public",

  server: {
    port: 3000,
    host: true,
    // The live preview is served from a proxied host; accept it.
    allowedHosts: true,
  },
  preview: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },

  // PostCSS passthrough + esbuild minify. Lightning CSS (Vite's default)
  // emits empty `--lightningcss-*` custom properties that are valid in
  // browsers but unparseable by jsdom's CSS parser, which the smoke test
  // depends on. This CSS is already baseline-modern; it needs minifying,
  // not transforming.
  css: { transformer: "postcss" },

  build: {
    outDir: "dist",
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 300,
    cssMinify: "esbuild",
  },

  plugins: [
    VitePWA({
      strategies: "generateSW",
      // We register manually in src/main.js to keep the "new version" prompt.
      injectRegister: false,
      // The hand-written manifest in public/ stays authoritative.
      manifest: false,
      workbox: {
        // Never precache the archive itself: it is megabytes of content, not
        // shell, and it changes independently of the code.
        globPatterns: ["**/*.{js,css,html,webmanifest,png,svg,ico}"],
        globIgnores: ["data/**", "POSTS.json"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Updates apply on user confirmation (main.js posts SKIP_WAITING).
        skipWaiting: false,
        runtimeCaching: [
          {
            // The archive: always try the network, fall back to cache.
            urlPattern: ({ url }) =>
              url.pathname.endsWith(".json") &&
              (url.pathname.includes("/data/") || url.pathname.endsWith("POSTS.json")),
            handler: "NetworkFirst",
            options: {
              cacheName: "xarc-data",
              expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 3600 },
              networkTimeoutSeconds: 8,
            },
          },
          {
            // CDN thumbnails and avatars: serve fast, refresh behind.
            urlPattern: ({ url }) =>
              url.hostname === "pbs.twimg.com" && /\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "xarc-images",
              expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            // Video streams: never cached. Range requests do not survive a
            // cache, and the files are far too large to hold.
            urlPattern: ({ url }) =>
              url.hostname === "video.twimg.com" || url.pathname.endsWith(".mp4"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
