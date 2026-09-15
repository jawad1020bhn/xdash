/* =============================================================================
   viewer v3 — the full-screen media theatre.

   One item at a time, filmstrip of its siblings below, every control within
   thumb reach on a phone and within arrow-key reach on a desk.
   ========================================================================== */

import { h, icon, clear, pushEsc, reducedMotion } from "./ui/dom.js";
import { state, markViewed, markStarred, isStarred, saveProgress, getProgress, setPrefs } from "./core/state.js";
import { post } from "./core/query.js";
import { avatar, caption, fmtCount, fmtDuration, describe, videoEl as buildVideo } from "./ui/media.js";
import { sizedImage } from "./core/data.js";

let root = null;
let releaseEsc = null;
let list = [];
let index = 0;
let videoEl = null;

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

  render();
  requestAnimationFrame(() => root.classList.add("is-in"));
  addEventListener("keydown", onKey);
}

export function closeViewer(instant = false) {
  if (!root) return;
  removeEventListener("keydown", onKey);
  releaseEsc?.();
  releaseEsc = null;
  const el = root;
  root = null;
  try { videoEl?.pause?.(); } catch { /* no media pipeline */ }
  videoEl = null;
  document.body.style.overflow = "";
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
      },
    }, icon(starOn ? "starFill" : "star", 22)),
    h("button.icon-btn", {
      type: "button",
      "aria-label": "Toggle crop-to-fill (C)",
      title: "Crop to fill / show whole frame",
      onclick: toggleFit,
    }, icon((state.prefs.viewerFit || "contain") === "cover" ? "expand" : "compress", 22)),
    h("button.icon-btn", { type: "button", "aria-label": "Full screen (F)", onclick: toggleFullscreen }, icon("expand", 22)),
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

  /* swipe on touch */
  wireSwipe(stage);
}

function step(dir) {
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

/* ----------------------------------------------------------------- swipe -- */

function wireSwipe(stage) {
  let x0 = null, y0 = null;
  stage.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; }, { passive: true });
  stage.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1);
  }, { passive: true });
}
