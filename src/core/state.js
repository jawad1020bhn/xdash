/* =============================================================================
   state v3 — one object, one subscription channel, one place truth lives.

   Storage keys are unchanged from v1/v2 on purpose (xBookmarks,
   xLibraryState, xDashboardPrefs): an archive already in this browser, or in
   the capture extension, opens as-is. That contract is load-bearing.

   Preferences stay short and human. Everything else is a product decision.
   ========================================================================== */

import { KEYS, getMany, setMany } from "./store.js";

/* ------------------------------------------------------------------ prefs -- */

export const PREF_DEFAULTS = {
  /* Appearance */
  themeMode: "system",        // system | dark | light
  density: "cozy",            // compact | cozy | roomy
  aspect: "4/5",              // tile aspect: 4/5 | 1/1 | 3/4 | 16/10
  motion: "auto",             // auto | reduced

  /* Media */
  autoplay: true,             // play the centred item in Watch
  startMuted: true,           // a feed that shouts at you is a feed you close
  watchFit: "cover",          // Watch feed: cover (uniform, cropped) | contain (whole frame, bars)
  viewerFit: "contain",       // theatre: contain by default, cover on demand
  rememberProgress: true,
  dimSeen: true,              // dim tiles already opened
  blurMedia: false,           // privacy blur until tapped
  safeText: true,             // clamp + soften explicit post text on cards

  /* Library */
  markViewedOnOpen: true,
  landing: "home",
  views: [],                  // saved library views: { name, query }

  /* Access — user-set, replacing the hard-coded password v1 shipped */
  pin: null,
};

export const LIBRARY_DEFAULTS = {
  viewed: {},        // mediaId -> timestamp
  archived: {},      // postId -> true
  starred: {},       // mediaId -> true
  progress: {},      // mediaId -> seconds
  hidden: {},        // mediaId -> true
};

/* ------------------------------------------------------------------ shape -- */

export const state = {
  ready: false,
  route: "home",
  index: { posts: new Map(), media: [], authors: [] },
  source: "none",
  prefs: { ...PREF_DEFAULTS },
  library: { ...LIBRARY_DEFAULTS },
  query: {
    search: "",
    kind: "all",             // all | video | photo
    author: null,
    sort: "recent",          // recent | oldest | liked | reposted | longest | shortest | random
    unseen: false,
    starred: false,
    includeHidden: false,
  },
  ui: {
    selecting: false,
    selected: new Set(),
    loadMessage: "",
  },
};

/* -------------------------------------------------------------- subscribe -- */

const listeners = new Set();
let scheduled = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Coalesces a burst of mutations into one repaint per frame. */
export function notify() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const fn of listeners) {
      try { fn(state); } catch (err) { console.error("[state] listener failed", err); }
    }
  });
}

export function set(patch) {
  Object.assign(state, patch);
  notify();
}

export function setQuery(patch) {
  Object.assign(state.query, patch);
  notify();
}

export function resetQuery() {
  Object.assign(state.query, {
    search: "", kind: "all", author: null, sort: "recent",
    unseen: false, starred: false, includeHidden: false,
  });
  notify();
}

/* ----------------------------------------------------------------- prefs -- */

let saveTimer = 0;

export function setPrefs(patch) {
  Object.assign(state.prefs, patch);
  applyPrefs();
  notify();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    setMany({ [KEYS.prefs]: state.prefs }).catch(() => {});
  }, 200);
}

export function resetPrefs() {
  const pin = state.prefs.pin;
  Object.assign(state.prefs, PREF_DEFAULTS, { pin });
  applyPrefs();
  notify();
  setMany({ [KEYS.prefs]: state.prefs }).catch(() => {});
}

/** The preferences that change how the document itself renders. */
export function applyPrefs() {
  const root = document.documentElement;
  const dark = state.prefs.themeMode === "system"
    ? matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true
    : state.prefs.themeMode === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.density = state.prefs.density;
  root.dataset.aspect = state.prefs.aspect;
  root.dataset.motion = state.prefs.motion === "reduced" ? "reduced" : "full";
  root.dataset.blur = state.prefs.blurMedia ? "on" : "off";

  const metas = document.querySelectorAll('meta[name="theme-color"]');
  for (const meta of metas) {
    const media = meta.getAttribute("media") || "";
    if (state.prefs.themeMode === "system" && media) continue;   // let the OS decide
    if (media.includes("dark") && !dark) continue;
    if (media.includes("light") && dark) continue;
    meta.setAttribute("content", dark ? "#0c0a09" : "#f5f2ec");
  }
}

/* --------------------------------------------------------------- library -- */

let libTimer = 0;
function saveLibrary() {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => {
    setMany({ [KEYS.library]: state.library }).catch(() => {});
  }, 250);
}

export function markViewed(mediaId, on = true) {
  if (on) state.library.viewed[mediaId] = Date.now();
  else delete state.library.viewed[mediaId];
  saveLibrary();
  notify();
}

export function markStarred(mediaId, on = !state.library.starred[mediaId]) {
  if (on) state.library.starred[mediaId] = true;
  else delete state.library.starred[mediaId];
  saveLibrary();
  notify();
  return on;
}

export function markArchived(postId, on = !state.library.archived[postId]) {
  if (on) state.library.archived[postId] = true;
  else delete state.library.archived[postId];
  saveLibrary();
  notify();
  return on;
}

export function markHidden(mediaId, on = !state.library.hidden[mediaId]) {
  if (on) state.library.hidden[mediaId] = true;
  else delete state.library.hidden[mediaId];
  saveLibrary();
  notify();
  return on;
}

export function saveProgress(mediaId, seconds) {
  if (!state.prefs.rememberProgress) return;
  if (seconds > 1) state.library.progress[mediaId] = Math.round(seconds);
  else delete state.library.progress[mediaId];
  saveLibrary();
}

export const isViewed = (id) => !!state.library.viewed[id];
export const isStarred = (id) => !!state.library.starred[id];
export const isArchived = (postId) => !!state.library.archived[postId];
export const isHidden = (id) => !!state.library.hidden[id];
export const getProgress = (id) => state.library.progress[id] || 0;

/* ------------------------------------------------------------------ load -- */

export async function loadPersisted() {
  const data = await getMany([KEYS.prefs, KEYS.library]);
  state.prefs = { ...PREF_DEFAULTS, ...(data[KEYS.prefs] || {}) };
  state.library = { ...LIBRARY_DEFAULTS, ...(data[KEYS.library] || {}) };
  for (const key of Object.keys(LIBRARY_DEFAULTS)) {
    if (!state.library[key] || typeof state.library[key] !== "object") state.library[key] = {};
  }
  if (!Array.isArray(state.prefs.views)) state.prefs.views = [];
  applyPrefs();
}

export async function persistBookmarks(list) {
  await setMany({ [KEYS.bookmarks]: list });
}

/* ------------------------------------------------------------- selection -- */

export function toggleSelected(id) {
  const next = new Set(state.ui.selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  state.ui.selected = next;
  state.ui.selecting = next.size > 0;
  notify();
  return next.has(id);
}

export function clearSelection() {
  if (!state.ui.selected.size && !state.ui.selecting) return;
  state.ui.selected = new Set();
  state.ui.selecting = false;
  notify();
}

export function selectAll(ids) {
  state.ui.selected = new Set(ids);
  state.ui.selecting = ids.length > 0;
  notify();
}

/* -------------------------------------------------------- saved views ----- */

export function saveView(name) {
  const view = { name, query: { ...state.query } };
  state.prefs.views = [...state.prefs.views.filter((v) => v.name !== name), view].slice(-8);
  setPrefs({});
  return view;
}

export function deleteView(name) {
  state.prefs.views = state.prefs.views.filter((v) => v.name !== name);
  setPrefs({});
}
