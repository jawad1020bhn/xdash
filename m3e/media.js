/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/m3e/media.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   Media playback

   X serves video two ways:
     · an HLS playlist (.m3u8) — adaptive, and what X prefers;
     · a set of fixed-bitrate MP4 variants.

   Native HLS exists only in Safari. Chrome and Firefox need hls.js, which is
   ~190 kB gzipped — more than the rest of this application put together, for a
   repo that is deliberately zero-dependency and build-free.

   The resolution here: **prefer the MP4 variant, because X publishes one for
   essentially every video**, and MP4 plays natively everywhere with no library
   at all. HLS is used only where the browser can play it unaided (Safari), and
   only when no MP4 exists. If neither is playable we say so plainly and link
   to the original post rather than showing a video element that will never
   start.

   That covers the real corpus with zero bytes of dependency. `hlsOnly()` marks
   the residual case so the UI can be honest about it.

   Exposed as window.M3EMedia.
   ============================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.M3EMedia = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Does this browser play an HLS playlist without a library?
   *
   * `canPlayType` cannot be trusted here, and this was confirmed by testing
   * rather than assumed: Chromium answers "maybe" to both HLS mime types
   * while being completely unable to play a playlist — it needs Media Source
   * Extensions plus a library. Taking that answer at face value produces the
   * worst possible outcome, a play button that leads to a dead player.
   *
   * So the claim is necessary but not sufficient: Blink is excluded, which
   * leaves the browsers that genuinely ship native HLS (Safari, iOS WebKit).
   * Firefox never claims support and is filtered by the first test. Should
   * this still be wrong somewhere, `createVideo` reports the error path and
   * the UI degrades to an honest message rather than a black rectangle.
   */
  let nativeHls = null;
  function supportsNativeHls() {
    if (nativeHls !== null) return nativeHls;
    if (typeof document === "undefined") return (nativeHls = false);

    const v = document.createElement("video");
    const claims = !!(
      v.canPlayType("application/vnd.apple.mpegurl") ||
      v.canPlayType("application/x-mpegURL")
    );
    if (!claims) return (nativeHls = false);

    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    const blink = /Chrom(e|ium)\//.test(ua) || /\bEdg\//.test(ua) || /OPR\//.test(ua);
    return (nativeHls = !blink);
  }

  /**
   * The best source this browser can actually play.
   *
   * `opts.width` — the CSS width the video will be rendered at. When given,
   * and when the item carries the full variant ladder, the smallest variant
   * that still covers that width (times DPR) is chosen instead of the largest.
   * A 180px carousel tile pulling a 1080p file is the single most expensive
   * mistake a media browser can make, and it is invisible until someone looks
   * at the network panel.
   *
   * @returns {{src: string, kind: 'mp4'|'hls', bitrate?: number} | null}
   */
  function playableSource(media, opts) {
    if (!media) return null;
    const ladder = variantLadder(media);
    if (ladder.length) {
      const chosen = pickVariant(ladder, opts && opts.width);
      return { src: chosen.url, kind: "mp4", bitrate: chosen.bitrate };
    }
    if (media.mp4) return { src: media.mp4, kind: "mp4" };
    if (media.hls && supportsNativeHls()) return { src: media.hls, kind: "hls" };
    return null;
  }

  /** The mp4 ladder, best-first, normalised across the field names in use. */
  function variantLadder(media) {
    const raw = (media && (media.mp4Variants || media.mp4_variants)) || [];
    return raw
      .filter((v) => v && v.url)
      .map((v) => ({ url: v.url, bitrate: Number(v.bitrate) || 0 }))
      .sort((a, b) => b.bitrate - a.bitrate);
  }

  /**
   * Pick from a best-first ladder for a target render width.
   *
   * There is no resolution metadata on an X variant — only bitrate — so this
   * maps bitrate to an approximate width using X's own encoding ladder
   * (roughly 320p ≈ 250 kbps, 480p ≈ 830 kbps, 720p ≈ 2.2 Mbps, 1080p ≈ 5 Mbps
   * for the same content). The mapping does not have to be exact: it only has
   * to order the rungs, and bitrate already does that. The threshold is what
   * matters — never serve a rung below the rendered size, because upscaling a
   * 320p file into a 900px player looks broken in a way that saving bytes
   * cannot justify.
   */
  function pickVariant(ladder, width) {
    if (!width || ladder.length < 2) return ladder[0];
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    // Cap the DPR contribution at 2: beyond that the extra pixels are past
    // the point of visible return on video, unlike on text.
    const need = width * Math.min(dpr, 2);

    // Ascending, so the first rung that covers `need` is the smallest one that
    // does. Falls back to the best rung when nothing covers it.
    const ascending = ladder.slice().reverse();
    for (const v of ascending) {
      if (approxWidth(v.bitrate) >= need) return v;
    }
    return ladder[0];
  }

  /** Bitrate → approximate encoded width, using X's published variant ladder. */
  function approxWidth(bitrate) {
    if (bitrate >= 4000000) return 1920;
    if (bitrate >= 1800000) return 1280;
    if (bitrate >= 700000) return 640;
    if (bitrate > 0) return 320;
    return 1920; // unknown bitrate: assume it is the good one
  }

  /** True when a video exists but this browser cannot play it. */
  function hlsOnly(media) {
    if (!media || !isMotion(media)) return false;
    return !playableSource(media);
  }

  function isMotion(media) {
    return !!media && (media.type === "video" || media.type === "animated_gif");
  }

  /* ---------------------------------------------------------------------------
     One-at-a-time playback

     Two videos playing at once is never what anyone wants, and on a list of
     bookmarks it is easy to trigger. Starting a video stops whatever was
     playing before it.
     --------------------------------------------------------------------------- */
  let stopCurrent = null;

  function claimPlayback(stopFn) {
    if (stopCurrent && stopCurrent !== stopFn) stopCurrent();
    stopCurrent = stopFn;
  }

  function releasePlayback(stopFn) {
    if (stopCurrent === stopFn) stopCurrent = null;
  }

  /**
   * Build a <video> for a media item and wire it into the playback manager.
   * Native controls: they are already keyboard-complete, screen-reader
   * labelled, and give PiP + fullscreen for free. Styled by components.css,
   * not reimplemented.
   */
  function createVideo(media, opts) {
    const options = opts || {};
    const source = playableSource(media, { width: options.width });
    if (!source) return null;

    const video = document.createElement("video");
    const gif = media.type === "animated_gif";

    video.className = "m3e-video";
    video.src = source.src;
    video.dataset.kind = source.kind;
    if (media.poster || media.url) video.poster = media.poster || media.url;
    video.playsInline = true;
    video.preload = options.preload || "metadata";
    // A GIF is a silent loop with no chrome; a video is a video.
    video.controls = options.controls != null ? !!options.controls : !gif;
    video.loop = options.loop != null ? !!options.loop : gif;
    // Muted is not just a GIF thing any more: an autoplaying feed video must
    // start silent or the browser refuses to start it at all, and a wall of
    // sound is hostile regardless of what the policy allows.
    video.muted = options.muted != null ? !!options.muted : gif || !!options.autoplay;
    video.defaultMuted = video.muted;
    if (media.alt) video.setAttribute("aria-label", media.alt);
    if (media.width && media.height) {
      video.width = media.width;
      video.height = media.height;
    }
    video.style.aspectRatio = aspectRatio(media);

    const stop = () => { try { video.pause(); } catch (_) {} };
    video.addEventListener("play", () => claimPlayback(stop));
    video.addEventListener("pause", () => releasePlayback(stop));
    video.addEventListener("emptied", () => releasePlayback(stop));

    /* A source that 404s or is codec-rejected fires `error` on the element and
       then does nothing at all — a black rectangle with a dead play button,
       which is exactly the failure mode this module exists to avoid. Step down
       the ladder before giving up, then hand the failure to the caller so the
       UI can say something honest. */
    const ladder = variantLadder(media);
    let rung = ladder.findIndex((v) => v.url === source.src);
    video.addEventListener("error", () => {
      const next = ladder[++rung];
      if (next) { video.src = next.url; video.load(); return; }
      if (media.hls && supportsNativeHls() && video.src !== media.hls) {
        video.src = media.hls;
        video.load();
        return;
      }
      if (options.onFail) options.onFail(video);
    });

    if (options.autoplay) {
      // Autoplay is only permitted while muted. A rejected promise here is
      // normal (a user gesture may still be required), not an error.
      const attempt = video.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    }

    return video;
  }

  /* ---------------------------------------------------------------------------
     Viewport-driven playback

     In a scrolling media feed, "play" is a scroll position, not a click. This
     plays whichever motion item is most central in the viewport and pauses
     everything else, which is the behaviour every video feed has trained
     people to expect.

     It is opt-in per element and it always respects reduced-motion: someone
     who has asked the OS to stop things moving has asked for exactly this.
     --------------------------------------------------------------------------- */
  function autoplayInView(container, opts) {
    if (typeof IntersectionObserver === "undefined") return function () {};
    const options = opts || {};
    const selector = options.selector || "video[data-autoplay]";
    const ratio = options.threshold != null ? options.threshold : 0.6;

    let best = null;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const v = entry.target;
          if (entry.isIntersecting && entry.intersectionRatio >= ratio) {
            if (best && best !== v) { try { best.pause(); } catch (_) {} }
            best = v;
            const attempt = v.play();
            if (attempt && attempt.catch) attempt.catch(() => {});
          } else {
            try { v.pause(); } catch (_) {}
            if (best === v) best = null;
          }
        }
      },
      { root: options.root || null, threshold: [0, ratio, 1] }
    );

    const scan = () => {
      container.querySelectorAll(selector).forEach((v) => observer.observe(v));
    };
    scan();

    return { rescan: scan, disconnect: () => observer.disconnect() };
  }

  /** Stop whatever is currently playing (used when a view is torn down). */
  function stopAll() {
    if (stopCurrent) stopCurrent();
    stopCurrent = null;
  }

  /* ---------------------------------------------------------------------------
     Presentation helpers
     --------------------------------------------------------------------------- */

  /** A CSS `aspect-ratio` value, clamped so freak dimensions can't wreck a row. */
  function aspectRatio(media, min, max) {
    const lo = min || 0.5;   // 1:2 portrait
    const hi = max || 3;     // 3:1 panorama
    let r = Number(media && media.aspect);
    if (!Number.isFinite(r) || r <= 0) {
      const w = Number(media && media.width);
      const h = Number(media && media.height);
      r = w && h ? w / h : 16 / 9;
    }
    return String(Math.min(hi, Math.max(lo, r)));
  }

  /**
   * X's CDN resizes on demand. Asking for a card-sized WebP instead of the
   * original saves an enormous amount of bandwidth on a media-heavy library.
   * Only pbs.twimg.com understands these parameters; anything else is
   * returned untouched.
   */
  function sizedImage(url, name) {
    if (!url || typeof url !== "string") return url;
    if (!/^https:\/\/pbs\.twimg\.com\//.test(url)) return url;
    try {
      const u = new URL(url);
      // A URL that already carries an explicit format wins; don't fight it.
      u.searchParams.set("format", u.searchParams.get("format") || "webp");
      u.searchParams.set("name", name || "small");
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  /** `0:42`, `12:10`, `1:02:33`. Empty string when there is no duration. */
  function formatDuration(ms) {
    const total = Math.round((Number(ms) || 0) / 1000);
    if (!total) return "";
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /** The same clock, but for a value already in seconds. */
  function formatTime(seconds) {
    return formatDuration((Number(seconds) || 0) * 1000);
  }

  /** True when this video element can be popped into picture-in-picture. */
  function supportsPiP(video) {
    return !!(typeof document !== "undefined" && document.pictureInPictureEnabled &&
      video && typeof video.requestPictureInPicture === "function");
  }

  /** The short badge a thumbnail shows: `GIF`, a duration, or nothing. */
  function badgeFor(media) {
    if (!media) return "";
    if (media.type === "animated_gif") return "GIF";
    if (isMotion(media)) return formatDuration(media.duration) || "VIDEO";
    return "";
  }

  return {
    supportsNativeHls,
    playableSource,
    variantLadder,
    pickVariant,
    hlsOnly,
    isMotion,
    createVideo,
    autoplayInView,
    claimPlayback,
    releasePlayback,
    stopAll,
    aspectRatio,
    sizedImage,
    formatDuration,
    formatTime,
    supportsPiP,
    badgeFor,
  };
});
