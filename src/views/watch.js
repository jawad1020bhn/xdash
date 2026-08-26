/* =============================================================================
   watch — an immersive vertical feed.

   This is the surface people actually spend time in, so it gets the most care:

     · scroll-snap paging, so a flick lands on exactly one video
     · only the centred video plays; neighbours hold a poster, which keeps one
       socket open instead of five
     · chrome fades while you watch and returns on any input
     · the bottom bar is gone entirely — this view is the whole screen

   Slides are windowed to ±2 around the current one. At 745 videos, mounting
   every slide would mean 745 <video> elements.
   ============================================================================= */

import { h, icon, clear, reducedMotion, haptic } from "../ui/dom.js";
import { state, setQuery, markViewed, markStarred, saveProgress, isStarred } from "../core/state.js";
import { post as postOf, results, reshuffle } from "../core/query.js";
import { fmtDuration, fmtCount, fmtAgo, avatar, describe } from "../ui/media.js";
import { toast, emptyState } from "../ui/feedback.js";
import { openViewer } from "../viewer.js";

const WINDOW = 2;

let root = null;
let track = null;
let list = [];
let slides = new Map();
let current = 0;
let observer = null;
let unsub = [];
let hideTimer = 0;

export function mount(host) {
  list = results();
  if (!list.length) {
    root = h("section.watch");
    host.append(root);
    emptyState(root, {
      icon: "play",
      title: "Nothing to watch",
      message: "Your current filters leave no videos. Clear them to fill the feed.",
      action: { label: "Clear filters", onClick: () => { setQuery({ kind: "all", unseen: false, starred: false, search: "", author: null }); remount(host); } },
    });
    return;
  }

  root = h("section.watch", { "aria-label": "Watch feed" });
  track = h("div.watch__track");
  root.append(track);
  host.append(root);

  buildSlides();
  observe();
  wireGestures();
  wireKeys();
  chrome();
  unsub.push(() => {});
}

function remount(host) {
  unmount();
  mount(host);
}

export function unmount() {
  pauseAll();
  observer?.disconnect();
  observer = null;
  unsub.forEach((fn) => fn());
  unsub = [];
  slides.clear();
  document.removeEventListener("keydown", onKey, true);
  root = null;
  track = null;
}

/* ------------------------------------------------------------- slides ---- */

function buildSlides() {
  clear(track);
  slides = new Map();
  for (let i = 0; i < list.length; i++) {
    const slide = h("div.watch__slide", { dataset: { index: String(i) } });
    /* Poster-first: a slide costs one image until it becomes the centred one. */
    const item = list[i];
    if (item.poster || item.thumb) {
      slide.append(h("img.watch__poster", {
        src: item.poster || item.thumb, alt: "", loading: i < 3 ? "eager" : "lazy",
        decoding: "async", referrerpolicy: "no-referrer",
      }));
    }
    track.append(slide);
    slides.set(i, slide);
  }
}

function ensureVideo(i) {
  const slide = slides.get(i);
  const item = list[i];
  if (!slide || !item || slide.querySelector("video")) return slide?.querySelector("video");

  const video = h("video.watch__video", {
    playsinline: true, webkitPlaysInline: true, preload: "auto",
    crossorigin: "anonymous", "aria-label": describe(item, postOf(item)),
  });
  video.muted = state.prefs.startMuted;
  if (item.poster) video.poster = item.poster;
  if (item.video) {
    const src = document.createElement("source");
    src.src = item.video; src.type = "video/mp4";
    video.append(src);
  }

  const saved = state.library.progress[item.id];
  video.addEventListener("loadedmetadata", () => {
    if (saved && saved > 2 && saved < video.duration - 3) video.currentTime = saved;
  }, { once: true });

  video.addEventListener("timeupdate", () => {
    const bar = slide.querySelector(".watch__progress span");
    if (bar && video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    saveProgress(item.id, video.currentTime || 0);
  });
  video.addEventListener("ended", () => {
    if (state.prefs.loop) { video.currentTime = 0; video.play().catch(() => {}); }
    else goTo(current + 1);
  });
  video.addEventListener("error", () => {
    slide.append(h("div.watch__broken",
      icon("warning", 22),
      h("p", { text: "This video would not play." }),
      h("button.btn.btn--sm", { type: "button", text: "Next", onclick: () => goTo(current + 1) }),
    ));
  }, { once: true });

  slide.prepend(video);
  return video;
}

function destroyVideo(i) {
  const slide = slides.get(i);
  const video = slide?.querySelector("video");
  if (!video) return;
  saveProgress(list[i].id, video.currentTime || 0);
  video.pause();
  video.removeAttribute("src");
  video.load?.();
  video.remove();
}

function pauseAll(except) {
  for (const [i, slide] of slides) {
    if (i === except) continue;
    const video = slide.querySelector("video");
    if (video && !video.paused) video.pause();
  }
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
  if (i === current && slides.get(i)?.dataset.active === "true") return;
  current = i;

  /* Window the DOM: keep ±WINDOW videos, drop the rest. */
  for (const key of slides.keys()) {
    if (Math.abs(key - i) > WINDOW) destroyVideo(key);
    const slide = slides.get(key);
    slide.dataset.active = Math.abs(key - i) === 0 ? "true" : "false";
  }

  const slide = slides.get(i);
  const item = list[i];
  const p = postOf(item);
  paintMeta(slide, item, p, i);

  const video = ensureVideo(i);
  pauseAll(i);
  if (video && state.prefs.autoplay) {
    video.play().catch(() => { showTapToPlay(slide); });
  }
  markViewed(item.id);
  revealChrome();
}

function showTapToPlay(slide) {
  if (slide.querySelector(".watch__tap")) return;
  const el = h("button.watch__tap", {
    type: "button", "aria-label": "Tap to play",
    onclick: (e) => {
      const v = slide.querySelector("video");
      v?.play().catch(() => toast("This browser is blocking autoplay with sound."));
      e.currentTarget.remove();
    },
  }, icon("play", 26));
  slide.append(el);
}

function paintMeta(slide, item, p, i) {
  if (slide.querySelector(".watch__meta")) return;

  const meta = h("div.watch__meta",
    h("div.watch__progress", h("span")),
    h("div.watch__who",
      avatar(p.author_profile_image_url, 36, p.author_name),
      h("div.watch__who-text",
        h("b", { text: p.author_name || p.author_username }),
        h("small", { text: `@${p.author_username} · ${fmtAgo(p.capturedAt)}` }),
      ),
    ),
    p.text ? h("p.watch__text", { text: p.text.slice(0, 180) }) : null,
    h("div.watch__facts",
      item.dur ? h("span", {}, icon("clock", 12), fmtDuration(item.dur)) : null,
      p.like_count_at_capture ? h("span", {}, icon("heart", 12), fmtCount(p.like_count_at_capture)) : null,
      h("button.watch__fact", {
        type: "button", text: "Open",
        onclick: () => openViewer(list, i),
      }),
    ),
  );

  const actions = h("div.watch__actions",
    h("button.watch__action", {
      type: "button", "aria-label": "Star",
      "aria-pressed": isStarred(item.id) ? "true" : "false",
      onclick: (e) => {
        const on = markStarred(item.id);
        e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
        haptic(14);
      },
    }, icon("star", 22)),
    h("button.watch__action", {
      type: "button", "aria-label": "Mute or unmute",
      onclick: (e) => {
        const v = slide.querySelector("video");
        if (!v) return;
        v.muted = !v.muted;
        e.currentTarget.setAttribute("aria-pressed", v.muted ? "true" : "false");
        e.currentTarget.replaceChildren(icon(v.muted ? "mute" : "volume", 22));
        haptic(6);
      },
    }, icon(state.prefs.startMuted ? "mute" : "volume", 22)),
    h("button.watch__action", {
      type: "button", "aria-label": "Full screen",
      onclick: () => slide.querySelector("video")?.requestFullscreen?.().catch(() => {}),
    }, icon("fullscreen", 22)),
    h("button.watch__action", {
      type: "button", "aria-label": "More actions",
      onclick: () => import("../ui/actions.js").then((m) => m.openItemActions(item, list, i)),
    }, icon("more", 22)),
  );

  slide.append(meta, actions);
}

/* ------------------------------------------------------------ chrome ----- */

let chromeEl = null;
function chrome() {
  chromeEl = h("div.watch__chrome",
    h("button.icon-btn.watch__exit", {
      type: "button", "aria-label": "Leave Watch",
      onclick: () => import("../shell.js").then(({ navigate }) => navigate("home")),
    }, icon("arrowLeft", 22)),
    h("span.watch__counter.t-num.t-small"),
    h("button.icon-btn", {
      type: "button", "aria-label": "Shuffle the feed",
      onclick: () => { reshuffle(); remount(root.parentElement); toast("Feed shuffled"); },
    }, icon("shuffle", 20)),
  );
  root.append(chromeEl);
  updateCounter();
}

function updateCounter() {
  if (chromeEl) {
    chromeEl.querySelector(".watch__counter").textContent = `${current + 1} / ${list.length}`;
  }
}

function revealChrome() {
  if (!chromeEl) return;
  chromeEl.dataset.visible = "true";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const v = slides.get(current)?.querySelector("video");
    if (v && !v.paused) chromeEl.dataset.visible = "false";
  }, 2800);
  updateCounter();
}

/* ---------------------------------------------------------- gestures ----- */

function wireGestures() {
  let lastTap = 0;
  track.addEventListener("pointerup", (e) => {
    if (e.target.closest("button,a")) return;
    revealChrome();
    const now = Date.now();
    const slide = slides.get(current);
    const video = slide?.querySelector("video");

    if (now - lastTap < 300) {
      /* Double tap on the left seeks back, on the right seeks forward; with no
         video loaded it stars the item instead, which is the other thing people
         double-tap for. */
      if (video && video.duration) {
        const left = e.clientX < window.innerWidth / 2;
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (left ? -10 : 10)));
        flashSeek(slide, left ? -10 : 10);
      } else if (list[current]) {
        const on = markStarred(list[current].id, true);
        if (on) toast("Starred");
      }
      lastTap = 0;
      return;
    }
    lastTap = now;

    if (video) {
      if (video.paused) video.play().catch(() => {}); else video.pause();
    }
  }, { passive: true });
}

function flashSeek(slide, delta) {
  if (!slide || reducedMotion()) return;
  const el = h("span.watch__flash", { text: `${delta > 0 ? "+" : ""}${delta}s` });
  el.style.insetInlineStart = delta > 0 ? "68%" : "18%";
  slide.append(el);
  setTimeout(() => el.remove(), 600);
}

function wireKeys() {
  document.addEventListener("keydown", onKey, true);
}

function onKey(e) {
  const k = e.key;
  if (k === "ArrowDown" || k === "j" || k === "J") { e.preventDefault(); goTo(current + 1); }
  else if (k === "ArrowUp" || k === "k" || k === "K") { e.preventDefault(); goTo(current - 1); }
  else if (k === " ") {
    e.preventDefault();
    const v = slides.get(current)?.querySelector("video");
    if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
  } else if (k === "m" || k === "M") {
    const v = slides.get(current)?.querySelector("video");
    if (v) v.muted = !v.muted;
  } else if (k === "Escape") {
    import("../shell.js").then(({ navigate }) => navigate("home"));
  }
  revealChrome();
}

function goTo(i) {
  if (i < 0 || i >= list.length) return;
  const slide = slides.get(i);
  slide?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}
