/* =============================================================================
   media — how a photo or a video becomes pixels.

   Three rules, all of them about not lying to the layout engine:

     1. The box is sized from the item's real aspect ratio BEFORE the image
        arrives, so a 1,200-item grid never reflows as it fills in.
     2. Thumbnails ask the CDN for a small rendition instead of the ~1200px
        default, and fall back to the bare URL if that guess is wrong.
     3. Every image carries alt text. The archive's media is content, not
        decoration; the previous build shipped zero alt attributes.
   ============================================================================= */

import { h, icon, reducedMotion } from "./dom.js";
import { sizedImage, sizedAvatar } from "../core/data.js";
import { state } from "../core/state.js";

/** A description for assistive tech: the creator's alt text, else the post. */
export function describe(item, post) {
  if (item.alt) return item.alt;
  const who = post?.author_name || post?.author_username || "Unknown creator";
  const kind = item.kind === "photo" ? "Photo" : item.kind === "gif" ? "Animated GIF" : "Video";
  const text = (post?.text || "").trim();
  return text ? `${kind} by ${who}: ${text.slice(0, 140)}` : `${kind} by ${who}`;
}

/**
 * A thumbnail <img>. The wrapper owns the aspect box; the image only fills it.
 */
export function thumb(item, post, { eager = false, sizes = "(max-width: 719px) 50vw, 200px" } = {}) {
  const figure = h("figure.media", {
    style: { "--aspect": String(item.aspect || 1) },
  });

  const img = h("img.media__img", {
    alt: describe(item, post),
    loading: eager ? "eager" : "lazy",
    decoding: "async",
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

  /* If the size-suffixed URL is refused, drop the srcset and try the bare URL.
     This is what makes the CDN guess safe: the worst case is today's bytes. */
  let fellBack = false;
  img.addEventListener("error", () => {
    if (fellBack) { img.classList.add("is-broken"); return; }
    fellBack = true;
    img.removeAttribute("srcset");
    img.src = src;
  }, { once: false });

  img.addEventListener("load", () => {
    img.classList.add("is-loaded");
  }, { once: true });

  figure.append(img);

  if (state.prefs.blurMedia) {
    figure.append(h("button.media__blur", {
      type: "button", "aria-label": "Reveal this image",
      onclick: (e) => { e.stopPropagation(); e.currentTarget.remove(); },
    }, h("span.media__blur-icon", icon("eye", 18))));
  }

  if (item.n > 1) {
    figure.append(h("span.media__count.t-tiny.t-num", { text: `${item.pos}/${item.n}` }));
  }
  if (item.kind !== "photo") {
    figure.append(h("span.media__badge",
      icon(item.kind === "gif" ? "bolt" : "play", 13),
      item.dur ? h("span.t-tiny.t-num", { text: fmtDuration(item.dur) }) : null,
    ));
  }
  return figure;
}

/** Round creator avatar, sized for the slot it is going into. */
export function avatar(url, size = 28, name = "") {
  const el = h("img.avatar", {
    src: sizedAvatar(url, size >= 64 ? "_400x400" : "_200x200") || sizedAvatar(url, "_normal"),
    alt: name ? `Profile picture of ${name}` : "",
    width: size, height: size, loading: "lazy", decoding: "async",
    referrerpolicy: "no-referrer",
    style: { width: `${size}px`, height: `${size}px` },
  });
  el.addEventListener("error", () => { el.classList.add("is-broken"); }, { once: true });
  return el;
}

/* ------------------------------------------------------------- playback -- */

export function fmtDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const hrs = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hrs ? `${hrs}:${pad(min)}:${pad(sec)}` : `${min}:${pad(sec)}`;
}

/** "1.2K", "4.3M" — counts in a grid should never be wider than the grid. */
export function fmtCount(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "") + "M";
}

const RELATIVE = [
  [60_000, "s", 1000],
  [3_600_000, "m", 60_000],
  [86_400_000, "h", 3_600_000],
  [604_800_000, "d", 86_400_000],
  [2_629_800_000, "w", 604_800_000],
  [31_557_600_000, "mo", 2_629_800_000],
];

export function fmtAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 45_000) return "just now";
  for (const [limit, unit, divisor] of RELATIVE) {
    if (diff < limit) {
      const n = Math.max(1, Math.round(diff / divisor));
      return `${n}${unit} ago`;
    }
  }
  return `${Math.round(diff / 31_557_600_000)}y ago`;
}

export function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Total watch time in words — used on Home. */
export function fmtHours(seconds) {
  const hrs = seconds / 3600;
  if (hrs < 1) return `${Math.round(seconds / 60)} min`;
  return `${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)} hrs`;
}

/* --------------------------------------------------------------- video ---- */

/**
 * Creates a <video> wired to the product's playback preferences.
 * `preload="none"` everywhere except the viewer: a grid of 1,200 items must not
 * open a thousand sockets.
 */
export function videoEl(item, { muted = true, loop = false, preload = "none", poster = true } = {}) {
  const video = h("video.video", {
    playsinline: true,
    webkitPlaysInline: true,
    preload,
    muted,
    loop,
    crossorigin: "anonymous",
    "aria-label": "Video",
  });
  if (muted) video.muted = true;      // property, not just attribute — Safari
  if (poster && (item.poster || item.thumb)) video.poster = item.poster || item.thumb;

  const src = item.video;
  if (src) {
    const source = document.createElement("source");
    source.src = src;
    source.type = "video/mp4";
    video.append(source);
  }
  video.dataset.mediaId = item.id;
  return video;
}

/** Best-effort play. Autoplay is refused often enough that it is never fatal. */
export function tryPlay(video) {
  const p = video.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

export function motionOk() {
  return !reducedMotion();
}
