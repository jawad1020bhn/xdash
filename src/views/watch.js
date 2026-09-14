/* =============================================================================
   watch — an immersive vertical feed of everything playable.

   v3 is TikTok-fluent: only videos with a playable stream are in the feed
   (photos never were watchable, yet every one of them used to be a dead
   slide), the neighbours of the centred video preload their metadata, and
   the gestures match the muscle memory people bring — tap to pause, edges
   to seek, centre to star, hold for 2×. Single taps wait one beat so a
   double-tap never also pauses.

   One video plays at a time and at most three exist with data: the current
   one plus preloading neighbours. Everything outside ±2 slides is a poster.
   ============================================================================= */

import { h, icon, clear, reducedMotion, haptic } from "../ui/dom.js";
import { state, setQuery, markViewed, markStarred, saveProgress, isStarred, setPrefs } from "../core/state.js";
import { post as postOf, results, reshuffle } from "../core/query.js";
import { fmtDuration, fmtCount, fmtAgo, avatar, describe } from "../ui/media.js";
import { toast, emptyState } from "../ui/feedback.js";
import { openViewer } from "../viewer.js";

const WINDOW = 2;
const TAP_DELAY = 300;    // single/double-tap disambiguation window
const HOLD_DELAY = 450;   // press-and-hold before 2× kicks in
const SEEK_SECS = 10;

let root = null;
let track = null;
let chromeEl = null;
let counterEl = null;
let rateBadge = null;
let list = [];
let slides = new Map();
let current = 0;
let observer = null;
let hideTimer = 0;
let tapTimer = 0;
let destroyed = false;

export function mount(host) {
  destroyed = false;
  list = results().filter((m) => m.video);
  root = h("section.watch", { "aria-label": "Watch feed" });
  host.append(root);

  if (!list.length) {
    emptyState(root, {
      icon: "play",
      title: "No videos here",
      message: "Your current filters leave no playable videos. Clear them to fill the feed.",
      action: {
        label: "Clear filters",
        onClick: () => {
          setQuery({ kind: "all", unseen: false, starred: false, search: "", author: null, sort: "recent" });
          remount();
        },
      },
    });
    return;
  }

  current = 0;
  track = h("div.watch__track");
  root.append(track);
  buildSlides();
  buildChrome();
  observe();
  wireGestures();
  wireKeys();
  document.addEventListener("visibilitychange", onVisibility);
}

function remount() {
  const host = root?.parentElement;
  if (!host) return;
  unmount();
  mount(host);
}

export function unmount() {
  destroyed = true;
  pauseAll();
  observer?.disconnect();
  observer = null;
  clearTimeout(hideTimer);
  clearTimeout(tapTimer);
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("visibilitychange", onVisibility);
  slides.clear();
  root = null;
  track = null;
  chromeEl = null;
  counterEl = null;
  rateBadge = null;
}

/* ------------------------------------------------------------- slides ---- */

function buildSlides() {
  clear(track);
  slides = new Map();
  list.forEach((item, i) => {
    const slide = h("div.watch__slide", { dataset: { index: String(i) } });
    /* Poster-first: a slide costs one image until it nears the centre. */
    if (item.poster || item.thumb) {
      slide.append(h("img.watch__poster", {
        src: item.poster || item.thumb, alt: "",
        loading: i < 2 ? "eager" : "lazy",
        decoding: "async", referrerpolicy: "no-referrer",
      }));
    }
    track.append(slide);
    slides.set(i, slide);
  });
}

function currentVideo() {
  return slides.get(current)?.querySelector("video") || null;
}

/* ------------------------------------------------------- video manager --- */

/**
 * Materialises the video for a slide. The current slide preloads fully;
 * neighbours preload metadata so stepping feels instant. No `crossorigin`:
 * plain playback never needs it, and on some CDN responses the attribute
 * is what turns a playable stream into a CORS failure.
 */
function ensureVideo(i, preload = "auto") {
  const slide = slides.get(i);
  const item = list[i];
  if (!slide || !item) return null;
  const existing = slide.querySelector("video");
  if (existing) return existing;

  const video = h("video.watch__video", {
    playsinline: true, webkitPlaysInline: true, preload,
    "aria-label": describe(item, postOf(item)),
  });
  video.muted = state.prefs.startMuted;
  if (item.poster) video.poster = item.poster;
  const src = document.createElement("source");
  src.src = item.video;
  src.type = "video/mp4";
  video.append(src);

  const saved = state.library.progress[item.id];
  video.addEventListener("loadedmetadata", () => {
    if (saved && saved > 2 && video.duration && saved < video.duration - 3) {
      video.currentTime = saved;
    }
    onTime(slide, video);
  }, { once: true });
  video.addEventListener("timeupdate", () => onTime(slide, video));
  video.addEventListener("play", () => setPlayingUI(slide, true));
  video.addEventListener("pause", () => setPlayingUI(slide, false));
  video.addEventListener("ended", () => {
    saveProgress(item.id, 0);
    if (destroyed) return;
    if (state.prefs.loop) {
      video.currentTime = 0;
      safePlay(video, slide);
    } else {
      goTo(current + 1);
    }
  });
  video.addEventListener("error", () => paintBroken(slide), { once: true });

  const big = h("button.watch__bigplay", {
    type: "button", "aria-label": "Play", hidden: true,
    onclick: (e) => { e.stopPropagation(); safePlay(video, slide); },
  }, icon("play", 30));

  slide.prepend(video);
  slide.append(big);
  return video;
}

function destroyVideo(i) {
  const slide = slides.get(i);
  const video = slide?.querySelector("video");
  if (video) {
    saveProgress(list[i].id, video.currentTime || 0);
    video.pause();
    video.playbackRate = 1;
    video.removeAttribute("src");
    video.load?.();
    video.remove();
  }
  slide?.querySelector(".watch__bigplay")?.remove();
  slide?.querySelector(".watch__tap")?.remove();
}

function pauseAll(except = -1) {
  for (const [i, slide] of slides) {
    if (i === except) continue;
    const video = slide.querySelector("video");
    if (!video) continue;
    video.playbackRate = 1;
    if (!video.paused) {
      try { video.pause(); } catch { /* already gone */ }
    }
  }
}

function safePlay(video, slide) {
  try {
    const pr = video.play();
    if (pr && typeof pr.catch === "function") {
      pr.catch(() => showTapToPlay(slide));
    }
  } catch {
    showTapToPlay(slide);
  }
}

function onTime(slide, video) {
  if (!video.duration) return;
  const bar = slide.querySelector(".watch__progress span");
  if (bar) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
  const label = slide.querySelector(".watch__time");
  if (label) label.textContent = `${fmtDuration(video.currentTime)} / ${fmtDuration(video.duration)}`;
  const id = slide.dataset.mediaId;
  if (id) saveProgress(id, video.currentTime || 0);
}

function setPlayingUI(slide, playing) {
  const big = slide.querySelector(".watch__bigplay");
  if (big) big.hidden = playing;
}

function showTapToPlay(slide) {
  if (!slide || slide.querySelector(".watch__tap")) return;
  const el = h("button.watch__tap", {
    type: "button", "aria-label": "Tap to play",
    onclick: (e) => {
      e.stopPropagation();
      const v = slide.querySelector("video");
      if (v) safePlay(v, slide);
      e.currentTarget.remove();
    },
  }, icon("play", 26));
  slide.append(el);
}

function paintBroken(slide) {
  if (!slide || slide.querySelector(".watch__broken")) return;
  slide.append(h("div.watch__broken",
    icon("warning", 22),
    h("p", { text: "This video won't play here. It may be gone from X, or the network refused the stream." }),
    h("button.btn", { type: "button", text: "Next", onclick: () => goTo(current + 1) }),
  ));
}

/* ---------------------------------------------------------- centring ----- */

function observe() {
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.intersectionRatio < 0.6) continue;
      const i = Number(entry.target.dataset.index);
      if (Number.isNaN(i)) continue;
      activate(i);
    }
  }, { root: track, threshold: [0.6, 0.9] });

  for (const slide of slides.values()) observer.observe(slide);
}

function activate(i) {
  if (destroyed || !slides.get(i)) return;
  if (i === current && slides.get(i).dataset.active === "true") {
    revealChrome();
    return;
  }
  current = i;

  for (const key of slides.keys()) {
    const slide = slides.get(key);
    slide.dataset.active = key === i ? "true" : "false";
    if (Math.abs(key - i) > WINDOW) destroyVideo(key);
  }

  const slide = slides.get(i);
  const item = list[i];
  slide.dataset.mediaId = item.id;
  paintMeta(slide, item, i);

  const video = ensureVideo(i, "auto");
  ensureVideo(i + 1, "metadata");
  ensureVideo(i - 1, "metadata");
  pauseAll(i);

  if (video) {
    video.playbackRate = 1;
    if (state.prefs.autoplay) safePlay(video, slide);
    else setPlayingUI(slide, false);
  }
  markViewed(item.id);
  revealChrome();
  updateCounter();
}

/* -------------------------------------------------------------- meta ----- */

function paintMeta(slide, item, i) {
  if (slide.querySelector(".watch__meta")) return;
  const p = postOf(item);

  slide.append(h("div.watch__progress", { "aria-hidden": "true" }, h("span")));

  const meta = h("div.watch__meta",
    h("button.watch__who", {
      type: "button",
      "aria-label": `Everything by @${p.author_username || "unknown"}`,
      onclick: (e) => {
        e.stopPropagation();
        setQuery({ author: p.author_username, search: "", unseen: false, starred: false, kind: "all" });
        import("../shell.js").then(({ navigate }) => navigate("library"));
      },
    },
      avatar(p.author_profile_image_url, 40, p.author_name),
      h("span.watch__who-text",
        h("b", { text: p.author_name || p.author_username }),
        h("small", { text: `@${p.author_username} · ${fmtAgo(p.capturedAt)}` }),
      ),
    ),
    p.text ? h("p.watch__text", { text: p.text.slice(0, 180) }) : null,
    h("div.watch__facts",
      h("span.watch__time.t-num", { text: item.dur ? `0:00 / ${fmtDuration(item.dur)}` : "" }),
      p.like_count_at_capture ? h("span", {}, icon("heart", 12), fmtCount(p.like_count_at_capture)) : null,
      h("button.watch__fact", {
        type: "button", text: "Open",
        onclick: (e) => { e.stopPropagation(); openViewer(list, i); },
      }),
    ),
  );

  const actions = h("div.watch__actions",
    h("button.watch__action", {
      type: "button", "aria-label": "Star", dataset: { act: "star" },
      "aria-pressed": isStarred(item.id) ? "true" : "false",
      onclick: (e) => {
        e.stopPropagation();
        paintStar(slide, markStarred(item.id));
        haptic(14);
      },
    }, icon("star", 22)),
    h("button.watch__action", {
      type: "button", "aria-label": "Mute or unmute", dataset: { act: "mute" },
      "aria-pressed": state.prefs.startMuted ? "true" : "false",
      onclick: (e) => {
        e.stopPropagation();
        const muted = !state.prefs.startMuted;
        setPrefs({ startMuted: muted });
        for (const s of slides.values()) {
          const v = s.querySelector("video");
          if (v) v.muted = muted;
        }
        e.currentTarget.setAttribute("aria-pressed", muted ? "true" : "false");
        e.currentTarget.replaceChildren(icon(muted ? "mute" : "volume", 22));
        haptic(6);
      },
    }, icon(state.prefs.startMuted ? "mute" : "volume", 22)),
    h("button.watch__action", {
      type: "button", "aria-label": "Full screen", dataset: { act: "full" },
      onclick: (e) => { e.stopPropagation(); goFullscreen(slide); },
    }, icon("fullscreen", 22)),
    h("button.watch__action", {
      type: "button", "aria-label": "More actions", dataset: { act: "more" },
      onclick: (e) => {
        e.stopPropagation();
        import("../ui/actions.js").then((m) => m.openItemActions(item, list, i));
      },
    }, icon("more", 22)),
  );

  slide.append(meta, actions);
}

function paintStar(slide, on) {
  const btn = slide.querySelector('[data-act="star"]');
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
}

/** Fullscreen with the iPhone fallback: iOS Safari cannot fullscreen a page,
    but a video element has its own native player. */
function goFullscreen(slide) {
  const video = slide.querySelector("video");
  if (!video) return;
  if (document.fullscreenEnabled && video.requestFullscreen) {
    video.requestFullscreen().catch(() => tryNativePlayer(video));
  } else {
    tryNativePlayer(video);
  }
}

function tryNativePlayer(video) {
  if (typeof video.webkitEnterFullscreen === "function") {
    try { video.webkitEnterFullscreen(); return; } catch { /* fall through */ }
  }
  toast("Full screen isn't available here.");
}

/* ------------------------------------------------------------ chrome ----- */

function buildChrome() {
  counterEl = h("span.watch__counter.t-num.t-small");
  chromeEl = h("div.watch__chrome", { dataset: { visible: "true" } },
    h("button.icon-btn", {
      type: "button", "aria-label": "Leave Watch",
      onclick: () => import("../shell.js").then(({ navigate }) => navigate("home")),
    }, icon("arrowLeft", 22)),
    counterEl,
    h("button.icon-btn", {
      type: "button", "aria-label": "Shuffle the feed",
      onclick: () => { reshuffle(); remount(); toast("Feed shuffled"); },
    }, icon("shuffle", 20)),
  );
  rateBadge = h("div.watch__rate", { hidden: true, "aria-hidden": "true", text: "2×" });
  root.append(chromeEl, rateBadge);
  updateCounter();
}

function updateCounter() {
  if (counterEl) counterEl.textContent = `${current + 1} / ${list.length}`;
}

function revealChrome() {
  if (destroyed || !chromeEl) return;
  chromeEl.dataset.visible = "true";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (destroyed) return;
    const v = currentVideo();
    if (v && !v.paused) chromeEl.dataset.visible = "false";
  }, 2800);
}

/* ---------------------------------------------------------- gestures ----- */

function wireGestures() {
  let lastTap = 0;
  let sx = 0, sy = 0;
  let tracking = false;
  let moved = false;
  let holding = false;
  let holdTimer = 0;

  track.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.target.closest("button,a,input")) return;
    tracking = true;
    moved = false;
    sx = e.clientX;
    sy = e.clientY;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (!tracking || moved || destroyed) return;
      startHold();
    }, HOLD_DELAY);
  }, { passive: true });

  track.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    if (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) {
      moved = true;
      clearTimeout(holdTimer);
      if (holding) endHold();
    }
  }, { passive: true });

  track.addEventListener("pointerup", (e) => {
    clearTimeout(holdTimer);
    if (!tracking) return;
    tracking = false;
    if (holding) { endHold(); return; }
    if (moved || !e.isPrimary) return;
    if (e.target.closest("button,a,input")) return;
    handleTap(e);
  }, { passive: true });

  track.addEventListener("pointercancel", () => {
    clearTimeout(holdTimer);
    tracking = false;
    if (holding) endHold();
  }, { passive: true });

  function handleTap(e) {
    const now = Date.now();
    if (now - lastTap < TAP_DELAY) {
      clearTimeout(tapTimer);
      lastTap = 0;
      doubleTap(e);
      return;
    }
    lastTap = now;
    clearTimeout(tapTimer);
    /* The pause waits one beat: without this, every double-tap would also
       pause, which reads as the app fighting you. */
    tapTimer = setTimeout(() => {
      lastTap = 0;
      if (!destroyed) singleTap();
    }, TAP_DELAY);
  }

  function singleTap() {
    revealChrome();
    const video = currentVideo();
    if (!video) return;
    if (video.paused) safePlay(video, slides.get(current));
    else video.pause();
  }

  function doubleTap(e) {
    const w = window.innerWidth;
    const x = e.clientX;
    const video = currentVideo();
    if (video?.duration && x < w * 0.4) {
      video.currentTime = Math.max(0, video.currentTime - SEEK_SECS);
      flashSeek(slides.get(current), -SEEK_SECS);
    } else if (video?.duration && x > w * 0.6) {
      video.currentTime = Math.min(video.duration, video.currentTime + SEEK_SECS);
      flashSeek(slides.get(current), SEEK_SECS);
    } else {
      starBurst(e.clientX, e.clientY);
    }
    revealChrome();
    haptic(12);
  }

  function startHold() {
    const video = currentVideo();
    if (!video || video.paused) return;
    holding = true;
    video.playbackRate = 2;
    if (rateBadge) rateBadge.hidden = false;
    haptic(10);
  }

  function endHold() {
    holding = false;
    if (rateBadge) rateBadge.hidden = true;
    const video = currentVideo();
    if (video) video.playbackRate = 1;
  }
}

/** Double-tap the middle third to star, with a burst where you tapped. */
function starBurst(x, y) {
  const item = list[current];
  const slide = slides.get(current);
  if (!item || !slide) return;
  const on = markStarred(item.id);
  paintStar(slide, on);
  if (reducedMotion()) {
    toast(on ? "Starred" : "Star removed");
    return;
  }
  const rect = slide.getBoundingClientRect();
  const burst = h("span.watch__burst", {
    "aria-hidden": "true",
    class: on ? "" : "is-off",
    style: { left: `${x - rect.left}px`, top: `${y - rect.top}px` },
  }, icon("star", 64));
  slide.append(burst);
  setTimeout(() => burst.remove(), 720);
}

function flashSeek(slide, delta) {
  if (!slide || reducedMotion()) return;
  const el = h("span.watch__flash", { text: `${delta > 0 ? "+" : ""}${delta}s` });
  el.style.insetInlineStart = delta > 0 ? "68%" : "18%";
  slide.append(el);
  setTimeout(() => el.remove(), 600);
}

/* ------------------------------------------------------------ keys ------- */

function wireKeys() {
  document.addEventListener("keydown", onKey, true);
}

function onKey(e) {
  if (destroyed) return;
  const k = e.key;
  if (k === "ArrowDown" || k === "j" || k === "J") { e.preventDefault(); goTo(current + 1); }
  else if (k === "ArrowUp" || k === "k" || k === "K") { e.preventDefault(); goTo(current - 1); }
  else if (k === "Home") { e.preventDefault(); goTo(0); }
  else if (k === "End") { e.preventDefault(); goTo(list.length - 1); }
  else if (k === " ") {
    e.preventDefault();
    const v = currentVideo();
    if (v) {
      if (v.paused) safePlay(v, slides.get(current));
      else v.pause();
    }
  } else if (k === "m" || k === "M") {
    const v = currentVideo();
    if (v) {
      v.muted = !v.muted;
      setPrefs({ startMuted: v.muted });
    }
  } else if (k === "Escape") {
    import("../shell.js").then(({ navigate }) => navigate("home"));
    return;
  }
  revealChrome();
}

function onVisibility() {
  if (document.hidden) currentVideo()?.pause();
}

function goTo(i) {
  if (destroyed || i < 0 || i >= list.length) return;
  slides.get(i)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}
