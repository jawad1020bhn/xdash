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
  box.style.setProperty("--aspect", String(item.aspect || 1));
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
