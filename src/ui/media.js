/* =============================================================================
   media v3 — how a photo or a video becomes pixels.

   Three rules, unchanged because they were right:
     1. the box is sized from the item's real aspect BEFORE the image arrives,
        so a 1,200-item grid never reflows as it fills in;
     2. thumbnails ask the CDN for a small rendition and fall back to the bare
        URL if that guess is refused;
     3. every image carries alt text — the archive's media is content.
   ========================================================================== */

import { h, icon } from "./dom.js";
import { sizedImage, sizedAvatar } from "../core/data.js";

/* The export carries everything from 9:16 phone clips to 2.35:1 banners.
   Both ends are real media but make an unreadable grid, so tiles clamp the
   packing ratio to this band — the clamped sliver is what cover crops. */
export const ASPECT_MIN = 0.5;
export const ASPECT_MAX = 2.2;

/** Honest width/height for an item, within the tile clamp band. */
export function itemAspect(item, fallback = 0.8) {
  const a = item?.aspect > 0 ? item.aspect
    : item?.w && item?.h ? item.w / item.h : fallback;
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, a || fallback));
}

/* ------------------------------------------------------------- describe -- */

export function describe(item, post) {
  if (item.alt) return item.alt;
  const who = post?.author_name || post?.author_username || "Unknown creator";
  const kind = item.kind === "photo" ? "Photo" : item.kind === "gif" ? "Animated GIF" : "Video";
  const text = (post?.text || "").trim().replace(/\s+/g, " ");
  return text ? `${kind} by ${who}: ${text.slice(0, 120)}` : `${kind} by ${who}`;
}

/** Post text, tidied for display: links stripped, whitespace collapsed. */
export function caption(post, len = 160) {
  const t = (post?.text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > len ? `${t.slice(0, len)}…` : t;
}

/* ---------------------------------------------------------------- image -- */

export function thumbImg(item, post, { eager = false, sizes = "(max-width: 719px) 46vw, 220px" } = {}) {
  const img = h("img", {
    alt: describe(item, post),
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    fetchpriority: eager ? "high" : "auto",
    sizes,
    referrerpolicy: "no-referrer",
    draggable: "false",
  });

  const src = item.thumb || item.poster || "";
  const small = sizedImage(src, "small");
  const medium = sizedImage(src, "medium");

  if (small !== src && medium !== src) {
    img.setAttribute("srcset", `${small} 680w, ${medium} 1200w`);
    img.src = small;
  } else {
    img.src = src;
  }

  /* If the size-suffixed URL is refused, drop the srcset and retry bare.
     A wrong CDN guess degrades to today's bytes, never to a broken tile. */
  let fellBack = false;
  img.addEventListener("error", () => {
    if (fellBack) { img.classList.add("is-broken"); return; }
    fellBack = true;
    img.removeAttribute("srcset");
    img.src = src;
  });
  img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
  return img;
}

/** The aspect-reserved media box with its badges. */
export function mediaBox(item, post, { eager = false, sizes, className = "" } = {}) {
  const box = h(`div.tile__media${className ? ` ${className}` : ""}`);
  box.style.setProperty("--aspect", String(itemAspect(item)));
  box.append(thumbImg(item, post, { eager, sizes }));

  if (item.n > 1) box.append(h("span.tile__count", icon("image", 12), `${item.pos}/${item.n}`));
  if (item.kind !== "photo") {
    box.append(h("span.tile__badge",
      icon(item.kind === "gif" ? "bolt" : "play", 12),
      item.dur ? fmtDuration(item.dur) : "LIVE",
    ));
  }
  return box;
}

/* --------------------------------------------------------------- video -- */

/**
 * Build a <video> for an item, with a best-first source ladder:
 *   1. highest-bitrate MP4 rendition
 *   2. every smaller MP4 rendition (expired/rate-limited URLs then degrade,
 *      never break)
 *   3. the HLS stream on browsers that play it natively
 * If even the poster is present without any playable stream, the poster is
 * shown with a badge rather than a black player.
 */
export function videoEl(item, post, { controls = false, loop = false, muted = false, eager = true } = {}) {
  const video = h("video", {
    playsinline: "",
    controls: controls ? "" : null,
    loop: loop ? "" : null,
    muted: muted ? "" : null,
    preload: eager ? "auto" : "metadata",
    poster: item.poster || "",
    referrerpolicy: "no-referrer",   /* pbs/video.twimg.com expect this */
    "aria-label": describe(item, post),
  });

  const sources = (item.sources && item.sources.length)
    ? item.sources
    : (item.video ? [{ url: item.video, type: "video/mp4" }] : []);

  /* Fallback UI must be a sibling of the <video> — content inside a
     supported media element never paints. */
  const attachBadge = (label, icn = "bolt") => {
    const attach = () => {
      const host = video.parentElement;
      if (!host || host.querySelector(".vid-fallback")) return;
      host.append(h("span.vid-fallback", icon(icn, 16), label));
    };
    if (video.parentElement) attach();
    else queueMicrotask(attach);
  };

  if (!sources.length) {
    /* Poster-only exports: no stream at all — keep the frame, not a black
       player. The poster becomes a background image so it cannot vanish. */
    if (item.poster) video.style.backgroundImage = `url("${item.poster}")`;
    video.removeAttribute("poster");
    video.dataset.posterOnly = "true";
    attachBadge(item.poster ? "Poster only — no stream archived" : "No video in export", "play");
    return video;
  }

  /* The browser walks these in order natively: the first source whose type
     it can decode AND whose network fetch succeeds plays; a refused or
     expired rendition drops through to the next instead of a dead player.
     HLS is last because only Safari advertises support for it. */
  for (const src of sources) video.append(h("source", { src: src.url, type: src.type }));

  video.addEventListener("error", () => {
    if (video.currentSrc || video.getAttribute("src")) return;
    /* currentSrc stays empty only after every <source> was exhausted. */
    video.classList.add("is-broken");
    attachBadge("Playback unavailable — source refused");
  });
  video.addEventListener("loadeddata", () => video.classList.add("is-loaded"), { once: true });

  return video;
}

/* --------------------------------------------------------------- avatar -- */

export function avatar(url, size = 32, name = "") {
  const box = h("span.avatar", { style: { "--sz": `${size}px` } });
  if (url) {
    const img = h("img", {
      src: sizedAvatar(url, size > 90 ? "_400x400" : "_200x200"),
      alt: name ? `${name}'s avatar` : "Creator avatar",
      loading: "lazy", decoding: "async", referrerpolicy: "no-referrer",
    });
    img.addEventListener("error", () => { box.replaceChildren(fallback(name)); }, { once: true });
    box.append(img);
  } else {
    box.append(fallback(name));
  }
  return box;
}

function fallback(name) {
  return h("span", { text: (name || "?").trim().charAt(0).toUpperCase() || "?" });
}

/* ------------------------------------------------------------ formatting -- */

export function fmtCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  return String(Math.round(n));
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtHours(seconds) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.round(seconds / 60)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

export function fmtAgo(ts) {
  const diff = Date.now() - (ts || 0);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.round(d / 7)}w ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
}

export function fmtDate(ts) {
  return new Date(ts || 0).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
