/* =============================================================================
   watch v3 — the immersive snap feed.

   A vertical scroll-snap column where exactly three cells exist in the DOM at
   any moment (previous, current, next). The centred cell plays; everything
   else stays parked. Videos start muted, because a feed that shouts at you is
   a feed you close.
   ========================================================================== */

import { h, icon, clear, pushEsc, haptic, burst } from "../ui/dom.js";
import { state, setQuery, subscribe, markStarred, isStarred, saveProgress, getProgress, setPrefs, applyPrefs } from "../core/state.js";
import { results, post as postOf, reshuffle } from "../core/query.js";
import { avatar, caption, fmtCount, describe, videoEl } from "../ui/media.js";
import { emptyState, loadingState } from "../ui/feedback.js";
import { navigate } from "../shell.js";

let root = null;
let col = null;
let host = null;
let cells = new Map();
let list = [];
let current = 0;
let releaseEsc = null;
let unsub = [];

export function mount(host) {
  list = results().slice();
  root = h("div.watch", { "aria-label": "Immersive feed" });
  root.dataset.fit = state.prefs.watchFit || "cover";
  host.append(root);
  paintThemeColor("#000000");

  /* The archive may still be loading: rebuild the feed the moment it lands. */
  unsub.push(subscribe(() => {
    const r = results();
    if (!list.length && r.length) { teardown(); mount(host); }
  }));

  if (!list.length) {
    const box = h("div", { style: { height: "100dvh", display: "grid", placeItems: "center" } });
    if (!state.ready) loadingState(box, "watch");
    else emptyState(box, { icon: "play", title: "Nothing to watch", message: "Your archive has no media matching this view." });
    root.append(box);
    return;
  }

  col = h("div.watch__col");
  col.style.height = `${list.length * 100}dvh`;
  root.addEventListener("scroll", onScroll, { passive: true });
  releaseEsc = pushEsc(() => navigate("home"));

  root.append(topBar(), col);
  paint(true);
}

function teardown() {
  releaseEsc?.();
  releaseEsc = null;
  unsub.forEach((fn) => fn());
  unsub = [];
  pauseAll();
  cells.clear();
  root?.remove();
  root = null;
  col = null;
  applyPrefs();   /* restore the theme-color the feed borrowed */
}

function paintThemeColor(hex) {
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", hex));
}

export function unmount() { teardown(); host = null; }

/* ------------------------------------------------------------------ top -- */

function topBar() {
  const fitBtn = h("button.icon-btn", {
    type: "button",
    "aria-label": "Toggle crop-to-fill",
    title: "Crop to fill / show whole frame",
    onclick: () => {
      const fit = (state.prefs.watchFit || "cover") === "cover" ? "contain" : "cover";
      setPrefs({ watchFit: fit });
      root.dataset.fit = fit;
      fitBtn.replaceChildren(icon(fit === "cover" ? "expand" : "compress", 20));
    },
  }, icon((state.prefs.watchFit || "cover") === "cover" ? "expand" : "compress", 20));

  const muteBtn = h("button.icon-btn", {
    type: "button",
    "aria-label": state.prefs.startMuted ? "Unmute the feed" : "Mute the feed",
    "aria-pressed": state.prefs.startMuted ? "false" : "true",
    onclick: () => {
      const muted = !state.prefs.startMuted;
      setPrefs({ startMuted: muted });
      const v = cells.get(current)?.querySelector("video");
      if (v) v.muted = muted;
      muteBtn.replaceChildren(icon(muted ? "volumeOff" : "volume", 20));
      muteBtn.setAttribute("aria-label", muted ? "Unmute the feed" : "Mute the feed");
      muteBtn.setAttribute("aria-pressed", muted ? "false" : "true");
    },
  }, icon(state.prefs.startMuted ? "volumeOff" : "volume", 20));

  return h("div.watch__top",
    h("button.icon-btn", { type: "button", "aria-label": "Leave Watch", onclick: () => navigate("home") }, icon("close", 22)),
    h("button.icon-btn", {
      type: "button", "aria-label": "Shuffle the feed",
      onclick: () => { reshuffle(); setQuery({ sort: "random" }); },
    }, icon("shuffle", 20)),
    fitBtn,
    muteBtn,
    h("span.watch__idx", { text: `1 / ${list.length}` }),
  );
}

/* --------------------------------------------------------------- window -- */

let frame = 0;
function onScroll() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; paint(false); });
}

function paint(reset) {
  if (!root) return;
  const vh = window.innerHeight;
  const idx = Math.max(0, Math.min(list.length - 1, Math.round(root.scrollTop / vh)));
  if (idx === current && !reset) return;
  current = idx;

  root.querySelector(".watch__idx")?.replaceChildren(`${idx + 1} / ${list.length}`);

  const wanted = new Set([idx - 1, idx, idx + 1].filter((i) => i >= 0 && i < list.length));
  for (const [i, cell] of cells) {
    if (!wanted.has(i)) { pauseCell(cell); cell.remove(); cells.delete(i); }
  }
  for (const i of wanted) {
    let cell = cells.get(i);
    if (!cell) {
      cell = buildCell(list[i], i);
      cells.set(i, cell);
      col.append(cell);
    }
    cell.style.top = `${i * 100}dvh`;
  }
  playCurrent();
}

/* ----------------------------------------------------------------- cell -- */

function buildCell(item, i) {
  const p = postOf(item);
  const cell = h("div.watch__cell", { dataset: { i: String(i) } });

  const media = h("div.watch__media");
  if (item.kind === "photo") {
    const img = h("img", {
      src: item.thumb || item.full, alt: describe(item, p),
      loading: "eager", decoding: "async", referrerpolicy: "no-referrer",
    });
    media.append(img);
  } else {
    /* A snap feed loops: a clip that ends on a frozen frame feels broken.
       The theatre (viewer.js) is where looping is a preference. */
    const video = videoEl(item, p, { loop: true, muted: true, eager: i === current });
    /* Resume where this clip was last parked. */
    const resume = getProgress(item.id);
    if (resume > 1) {
      const seek = () => { try { video.currentTime = Math.min(resume, (video.duration || Infinity) - 0.5); } catch { /* no pipeline */ } };
      video.addEventListener("loadedmetadata", seek, { once: true });
    }
    video.addEventListener("timeupdate", () => saveProgress(item.id, video.currentTime));
    const spin = h("span.watch__spin", { "aria-hidden": "true" }, h("span.spinner"));
    video.addEventListener("waiting", () => spin.classList.add("is-in"));
    video.addEventListener("playing", () => spin.classList.remove("is-in"));
    video.addEventListener("canplay", () => spin.classList.remove("is-in"));
    media.append(video);
    cell.append(spin);
    cell.dataset.video = "1";
  }
  cell.append(media, h("div.watch__scrim"));

  cell.append(h("div.watch__meta",
    h("div.watch__who",
      avatar(p.author_profile_image_url, 32, p.author_name),
      h("span", { text: `@${p.author_username || "unknown"}` }),
      h("span", { style: { opacity: .6 }, text: `· ${fmtCount(p.like_count_at_capture || 0)}` , class: "t-num" }),
    ),
    caption(p, 140) ? h("p.watch__text", { text: caption(p, 140) }) : null,
  ));

  wireCellGestures(cell, item, i);

  const starOn = isStarred(item.id);
  cell.append(h("div.watch__acts",
    h("button.watch__act", {
      type: "button", "aria-label": starOn ? "Remove star" : "Star",
      class: starOn ? "is-on" : "",
      onclick: (e) => {
        const on = markStarred(item.id);
        e.currentTarget.classList.toggle("is-on", on);
        e.currentTarget.replaceChildren(icon(on ? "starFill" : "star", 22));
        if (on) { haptic(10); burst(cell.querySelector(".watch__media")); }
      },
    }, icon(starOn ? "starFill" : "star", 22)),
    h("button.watch__act", {
      type: "button", "aria-label": "Open in viewer",
      onclick: () => import("../viewer.js").then(({ openViewer }) => openViewer(list, i)),
    }, icon("expand", 22)),
    h("button.watch__act", {
      type: "button", "aria-label": "More",
      onclick: () => import("../ui/actions.js").then(({ itemActions }) => itemActions(item)),
    }, icon("more", 22)),
  ));

  return cell;
}

/* -------------------------------------------------------------- playback -- */

function playCurrent() {
  for (const [i, cell] of cells) {
    const video = cell.querySelector("video");
    if (!video) continue;
    if (i === current && state.prefs.autoplay) {
      video.muted = state.prefs.startMuted;
      safePlay(video);
    } else {
      video.pause?.();
    }
  }
}

/** play() is a promise in browsers and undefined in some DOMs. */
function safePlay(video) {
  try { video.play?.()?.catch?.(() => {}); } catch { /* no media pipeline */ }
}

function pauseCell(cell) {
  try { cell.querySelector("video")?.pause?.(); } catch { /* no media pipeline */ }
}

function pauseAll() {
  for (const cell of cells.values()) pauseCell(cell);
}

/* -------------------------------------------------------------- gestures -- */

/* Single tap toggles playback (photos open in the viewer); a double-tap
   stars with a burst, the feed gesture everyone already knows. Control
   taps are left alone. */
function wireCellGestures(cell, item, i) {
  let taps = 0, timer = 0;
  cell.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    taps++;
    if (taps === 1) {
      timer = setTimeout(() => { taps = 0; tapPrimary(cell, item, i); }, 260);
    } else {
      clearTimeout(timer);
      taps = 0;
      tapStar(cell, item);
    }
  });
}

function tapPrimary(cell, item, i) {
  if (item.kind === "photo") {
    import("../viewer.js").then(({ openViewer }) => openViewer(list, i));
    return;
  }
  const video = cell.querySelector("video");
  if (!video) return;
  if (video.paused) { try { video.play()?.catch?.(() => {}); } catch {} flash(cell, "play"); }
  else { try { video.pause?.(); } catch {} flash(cell, "pause"); }
}

function tapStar(cell, item) {
  markStarred(item.id, true);
  haptic(12);
  burst(cell.querySelector(".watch__media"));
  flash(cell, "starFill");
  const btn = cell.querySelector(".watch__acts .watch__act");
  btn?.classList.add("is-on");
  btn?.replaceChildren(icon("starFill", 22));
  btn?.setAttribute("aria-label", "Remove star");
}

/* A centre-screen glyph that blooms and fades on every tap action. */
function flash(cell, glyph) {
  const el = h("span.watch__flash", { "aria-hidden": "true" }, icon(glyph, 44));
  cell.append(el);
  setTimeout(() => el.remove(), 550);
}
