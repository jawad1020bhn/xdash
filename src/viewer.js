/* =============================================================================
   viewer v3 — the full-screen media theatre.

   One item at a time, filmstrip of its siblings below, every control within
   thumb reach on a phone and within arrow-key reach on a desk.
   ========================================================================== */

import { h, icon, clear, pushEsc, reducedMotion, haptic, burst } from "./ui/dom.js";
import { state, markViewed, markStarred, isStarred, saveProgress, getProgress, setPrefs, applyPrefs } from "./core/state.js";
import { post } from "./core/query.js";
import { avatar, caption, fmtCount, fmtDuration, describe, videoEl as buildVideo } from "./ui/media.js";
import { sizedImage } from "./core/data.js";

let root = null;
let releaseEsc = null;
let list = [];
let index = 0;
let videoEl = null;
let prevFocus = null;
let zoom = null;          /* { s, x, y, ox, oy, w, h, left, top } | null */
let slideTimer = 0;
let slideBtn = null;

export function openViewer(items, start = 0) {
  if (!items?.length) return;
  closeViewer(true);

  list = items;
  index = Math.max(0, Math.min(start, items.length - 1));

  root = h("div.vw", { role: "dialog", "aria-modal": "true", "aria-label": "Media viewer" });
  root.dataset.fit = state.prefs.viewerFit || "contain";
  document.body.append(root);
  document.body.style.overflow = "hidden";
  releaseEsc = pushEsc(closeViewer);
  prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paintThemeColor("#060504");

  render();
  requestAnimationFrame(() => root.classList.add("is-in"));
  addEventListener("keydown", onKey);
}

export function closeViewer(instant = false) {
  if (!root) return;
  removeEventListener("keydown", onKey);
  releaseEsc?.();
  releaseEsc = null;
  stopSlides();
  const el = root;
  root = null;
  zoom = null;
  try { videoEl?.pause?.(); } catch { /* no media pipeline */ }
  videoEl = null;
  document.body.style.overflow = "";
  applyPrefs();
  try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* opener gone */ }
  prevFocus = null;
  if (instant) { el.remove(); return; }
  el.classList.remove("is-in");
  setTimeout(() => el.remove(), 180);
}

/* ---------------------------------------------------------------- render -- */

function render() {
  if (!root) return;
  /* Stop the outgoing clip before its element is removed, otherwise an
     unmuted video can keep talking after the frame changes. */
  try { videoEl?.pause?.(); } catch { /* no media pipeline */ }
  clear(root);
  videoEl = null;
  zoom = null;

  const item = list[index];
  const p = post(item);
  const siblings = state.index.media.filter((m) => m.postId === item.postId);

  /* ---- top bar ---- */
  root.append(h("div.vw__top",
    h("button.icon-btn", { type: "button", "aria-label": "Close viewer", onclick: () => closeViewer() }, icon("close", 22)),
    h("div.vw__who",
      avatar(p.author_profile_image_url, 32, p.author_name),
      h("div", { style: { minWidth: 0 } },
        h("b", { text: p.author_name || p.author_username || "unknown" }),
        h("small", { text: `@${p.author_username || "unknown"}` }),
      ),
    ),
    h("span.vw__idx", { text: `${index + 1} / ${list.length}` }),
  ));

  /* ---- stage ---- */
  const stage = h("div.vw__stage");
  if (item.kind === "photo") {
    const img = h("img", {
      src: sizedImage(item.full || item.thumb, "large"),
      alt: describe(item, p),
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    img.addEventListener("error", () => { img.src = item.full || item.thumb; }, { once: true });
    stage.append(img);
  } else {
    const video = buildVideo(item, p, {
      controls: true,
      loop: state.prefs.loop !== false,
      muted: state.prefs.startMuted,
      eager: true,
    });
    /* Resume where this clip was last parked in the feed. */
    const resume = getProgress(item.id);
    if (resume > 1 && !video.dataset.posterOnly) {
      const seek = () => { try { video.currentTime = Math.min(resume, (video.duration || Infinity) - 0.5); } catch { /* no pipeline */ } };
      video.addEventListener("loadedmetadata", seek, { once: true });
    }
    video.addEventListener("timeupdate", () => saveProgress(item.id, video.currentTime));
    stage.append(video);
    videoEl = video;
    if (state.prefs.autoplay) { try { video.play()?.catch?.(() => {}); } catch { /* no media pipeline */ } }
  }

  if (index > 0) stage.append(h("button.vw__nav.vw__nav--l", { type: "button", "aria-label": "Previous item", onclick: () => step(-1) }, icon("chevronLeft", 24)));
  if (index < list.length - 1) stage.append(h("button.vw__nav.vw__nav--r", { type: "button", "aria-label": "Next item", onclick: () => step(1) }, icon("chevronRight", 24)));
  root.append(stage);

  /* ---- caption + stats ---- */
  const cap = caption(p, 220);
  root.append(h("div.vw__cap", { text: cap }));
  root.append(h("div.vw__stats",
    h("span", icon("heart", 12), fmtCount(p.like_count_at_capture || 0)),
    h("span", icon("refresh", 12), fmtCount(p.retweet_count_at_capture || 0)),
    item.kind !== "photo" ? h("span", icon("clock", 12), fmtDuration(item.dur)) : null,
  ));

  /* ---- control bar ---- */
  const starOn = isStarred(item.id);
  slideBtn = h("button.icon-btn", {
    type: "button", "aria-label": "Slideshow", "aria-pressed": slideTimer ? "true" : "false",
    class: slideTimer ? "is-on" : "",
    onclick: () => toggleSlideshow(),
  }, icon("play", 22));
  root.append(h("div.vw__bar",
    h("button.icon-btn", { type: "button", "aria-label": "Previous (J)", onclick: () => step(-1) }, icon("chevronLeft", 22)),
    item.kind !== "photo" ? h("button.icon-btn", {
      type: "button", "aria-label": "Play or pause (Space)",
      onclick: (e) => {
        if (!videoEl) return;
        if (videoEl.paused) videoEl.play(); else videoEl.pause();
        e.currentTarget.replaceChildren(icon(videoEl.paused ? "play" : "pause", 22));
      },
    }, icon("pause", 22)) : null,
    item.kind !== "photo" ? h("button.icon-btn", {
      type: "button", "aria-label": "Mute or unmute (M)",
      onclick: (e) => {
        if (!videoEl) return;
        videoEl.muted = !videoEl.muted;
        e.currentTarget.replaceChildren(icon(videoEl.muted ? "volumeOff" : "volume", 22));
      },
    }, icon(state.prefs.startMuted ? "volumeOff" : "volume", 22)) : null,
    h("button.icon-btn", {
      type: "button", "aria-label": starOn ? "Remove star (S)" : "Star (S)",
      class: starOn ? "is-on" : "",
      onclick: (e) => {
        const on = markStarred(item.id);
        e.currentTarget.classList.toggle("is-on", on);
        e.currentTarget.replaceChildren(icon(on ? "starFill" : "star", 22));
        if (on) { haptic(10); burst(root.querySelector(".vw__stage")); }
      },
    }, icon(starOn ? "starFill" : "star", 22)),
    h("button.icon-btn", {
      type: "button",
      "aria-label": "Toggle crop-to-fill (C)",
      title: "Crop to fill / show whole frame",
      onclick: toggleFit,
    }, icon((state.prefs.viewerFit || "contain") === "cover" ? "expand" : "compress", 22)),
    h("button.icon-btn", { type: "button", "aria-label": "Full screen (F)", onclick: toggleFullscreen }, icon("expand", 22)),
    slideBtn,
    h("button.icon-btn", {
      type: "button", "aria-label": "More actions",
      onclick: () => import("./ui/actions.js").then(({ itemActions }) => itemActions(item)),
    }, icon("more", 22)),
    h("button.icon-btn", { type: "button", "aria-label": "Next (K)", onclick: () => step(1) }, icon("chevronRight", 22)),
  ));

  /* ---- filmstrip of this post's media ---- */
  if (siblings.length > 1) {
    const film = h("div.vw__film", { "aria-label": "More media from this post" });
    for (const sib of siblings) {
      const btn = h("button", {
        type: "button",
        class: sib.id === item.id ? "is-cur" : "",
        "aria-label": `Show media ${sib.pos} of ${siblings.length}`,
        onclick: () => {
          const i = list.indexOf(sib);
          if (i >= 0) { index = i; render(); }
        },
      }, h("img", { src: sizedImage(sib.thumb || sib.poster, "small"), alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }));
      film.append(btn);
    }
    root.append(film);
  }

  if (state.prefs.markViewedOnOpen) markViewed(item.id);

  /* gestures: swipe, pinch, pan, zoom */
  wireGestures(stage);
}

function step(dir, auto = false) {
  if (!auto) stopSlides();
  const next = index + dir;
  if (next < 0 || next >= list.length) return;
  index = next;
  if (!reducedMotion()) {
    root.style.opacity = ".6";
    requestAnimationFrame(() => { root.style.opacity = ""; });
  }
  render();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else root?.requestFullscreen?.().catch(() => {});
}

/** Cover (uniform, centre-cropped) vs contain (whole frame, letterboxed). */
function toggleFit() {
  if (!root) return;
  const fit = root.dataset.fit === "cover" ? "contain" : "cover";
  root.dataset.fit = fit;
  setPrefs({ viewerFit: fit });
  const btn = [...root.querySelectorAll(".vw__bar .icon-btn")]
    .find((b) => /crop-to-fill/i.test(b.getAttribute("aria-label") || ""));
  btn?.replaceChildren(icon(fit === "cover" ? "expand" : "compress", 22));
}

function paintThemeColor(hex) {
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", hex));
}

/* -------------------------------------------------------------- keyboard -- */

function onKey(e) {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  switch (e.key) {
    case "ArrowRight": step(1); break;
    case "ArrowLeft": step(-1); break;
    case "j": case "J": step(1); break;
    case "k": case "K": step(-1); break;
    case "s": case "S": root?.querySelector(".vw__bar .icon-btn.is-on, .vw__bar .icon-btn")?.blur(); markStarred(list[index].id); render(); break;
    case "f": case "F": toggleFullscreen(); break;
    case "c": case "C": toggleFit(); break;
    case "m": case "M":
      if (videoEl) { videoEl.muted = !videoEl.muted; }
      break;
    case " ":
      if (videoEl) { e.preventDefault(); videoEl.paused ? videoEl.play() : videoEl.pause(); }
      break;
  }
}

/* ------------------------------------------------------------ slideshow -- */

function toggleSlideshow() {
  if (slideTimer) { stopSlides(); return; }
  slideBtn?.classList.add("is-on");
  slideBtn?.setAttribute("aria-pressed", "true");
  slideTimer = setInterval(() => {
    const v = videoEl;
    if (v && !v.paused && !v.ended) return;   /* let the clip finish */
    if (index >= list.length - 1) index = -1; /* wrap the room */
    step(1, true);
  }, 4500);
}

function stopSlides() {
  if (!slideTimer) return;
  clearInterval(slideTimer);
  slideTimer = 0;
  slideBtn?.classList.remove("is-on");
  slideBtn?.setAttribute("aria-pressed", "false");
}

/* ------------------------------------------------------------------ zoom -- */

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function zoomMedia() {
  return root?.querySelector(".vw__stage img, .vw__stage video") || null;
}

/* Scale around the cursor point, then clamp the pan so the frame can never
   be thrown off-screen. Base geometry is captured on first touch. */
function zoomAt(cx, cy, s2) {
  const m = zoomMedia();
  if (!m) return;
  if (!zoom) {
    const r = m.getBoundingClientRect();
    zoom = {
      s: 1, x: 0, y: 0, ox: r.width / 2, oy: r.height / 2,
      w: m.offsetWidth || r.width || 1, h: m.offsetHeight || r.height || 1,
      left: r.left, top: r.top,
    };
  }
  /* Media point under the cursor, in untransformed pixels. */
  const px = (cx - zoom.left - zoom.x - zoom.ox) / zoom.s + zoom.ox;
  const py = (cy - zoom.top - zoom.y - zoom.oy) / zoom.s + zoom.oy;
  zoom.s = clampN(s2, 1, 4);
  zoom.ox = clampN(px, 0, zoom.w);
  zoom.oy = clampN(py, 0, zoom.h);
  clampPan();
  applyZoom();
}

function clampPan() {
  if (!zoom) return;
  const mx = ((zoom.s - 1) * zoom.w) / 2, my = ((zoom.s - 1) * zoom.h) / 2;
  zoom.x = clampN(zoom.x, -mx, mx);
  zoom.y = clampN(zoom.y, -my, my);
}

function applyZoom() {
  const m = zoomMedia();
  if (!m) return;
  if (!zoom || zoom.s <= 1.01) {
    m.style.transform = "";
    m.style.transformOrigin = "";
    m.style.cursor = "";
    return;
  }
  m.style.transformOrigin = `${zoom.ox}px ${zoom.oy}px`;
  m.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  m.style.cursor = "grab";
}

function toggleZoom(cx, cy) {
  if (zoom && zoom.s > 1.05) { zoom = null; applyZoom(); return; }
  zoomAt(cx, cy, 2.4);
}

/* -------------------------------------------------------------- gestures -- */

function wireGestures(stage) {
  const pts = new Map();
  let pinchD0 = 0, pinchS0 = 1, gestured = false, downAt = 0;

  stage.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestured = false;
    downAt = Date.now();
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinchD0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      pinchS0 = zoom?.s || 1;
    }
  }, { passive: true });

  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinchS0 * d) / pinchD0);
      gestured = true;
      return;
    }
    if (zoom && zoom.s > 1) {
      zoom.x += e.clientX - prev.x;
      zoom.y += e.clientY - prev.y;
      clampPan();
      applyZoom();
      gestured = true;
    }
  }, { passive: true });

  const release = (e) => {
    const start = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size > 0 || !start) return;
    if (gestured || (zoom && zoom.s > 1)) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (e.target.closest?.("video")) return;   /* scrubbers keep their drag */
      step(dx < 0 ? 1 : -1);
    } else if (dy > 90 && dy > Math.abs(dx) * 1.3 && Date.now() - downAt < 900) {
      closeViewer();
    }
  };
  stage.addEventListener("pointerup", release, { passive: true });
  stage.addEventListener("pointercancel", () => pts.clear(), { passive: true });

  stage.addEventListener("dblclick", (e) => {
    if (e.target.closest?.("button")) return;
    toggleZoom(e.clientX, e.clientY);
  });
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, (zoom?.s || 1) * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
  }, { passive: false });
}
