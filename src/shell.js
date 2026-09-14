/* =============================================================================
   shell — the persistent frame: navbar, tab bar, routing.

   v3 is iOS-shaped: a slim translucent navbar with the view title and two
   icon actions, a bottom tab bar with three destinations, views that enter on
   a spring, and an edge swipe that goes back. The frame is built once and
   never rebuilt. Views mount into #main and own their own scroll position,
   which is remembered per route.
   ============================================================================= */

import { h, icon, clear, onBreakpoint, isTouch, haptic, reducedMotion } from "./ui/dom.js";
import { state, set, setPrefs, applyPrefs, subscribe } from "./core/state.js";
import { stats } from "./core/query.js";
import { toast } from "./ui/feedback.js";
import { buildTabBar } from "./components/tabbar.js";

/* The palette, settings and management sheets only load when first opened —
   they are never part of the entry chunk. */
const openPalette = () => import("./ui/palette.js").then((m) => m.openPalette());
const openSettings = () => import("./views/settings.js").then((m) => m.openSettings());
const openManage = () => import("./views/manage.js").then((m) => m.openManage());

const ROUTES = [
  { id: "home", label: "Home", icon: "home", title: "Home" },
  { id: "library", label: "Library", icon: "grid", title: "Library" },
  { id: "watch", label: "Watch", icon: "play", title: "Watch" },
];

export const ROUTE_IDS = ROUTES.map((r) => r.id);

let els = {};
let tabbar = null;
const views = {};
const scrollMemory = new Map();
let current = null;
let lastScroll = 0;
let hidingTabs = false;

/* An internal mirror of the hash history, used for one job only: knowing
   whether a swipe-back has somewhere to go. Browser chrome owns the real
   history; this is just a depth guard plus consecutive-dedupe. */
const navStack = [];
let pendingBack = false;

export function initShell(viewModules) {
  Object.assign(views, viewModules);
  els = {
    shell: document.getElementById("shell"),
    navbar: document.getElementById("navbar"),
    title: document.getElementById("navbarTitle"),
    tabbar: document.getElementById("tabbar"),
    main: document.getElementById("main"),
    boot: document.getElementById("boot"),
    search: document.getElementById("searchBtn"),
    menu: document.getElementById("menuBtn"),
  };

  tabbar = buildTabBar(els.tabbar, ROUTES, onTabSelect);
  wireNavbar();
  wireScrollChrome();
  wireSwipeBack();
  wireKeys();

  els.shell.hidden = false;
  els.boot?.remove();

  onBreakpoint(() => renderChromeBits());
  subscribe(() => renderChromeBits());
  renderChromeBits();
}

function onTabSelect(id) {
  if (state.route === id) {
    /* Tapping the tab you are already on returns you to its top. This is
       the one gesture every phone user expects and rarely finds. */
    scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }
  navigate(id);
}

function wireNavbar() {
  els.search.append(icon("search", 21));
  els.search.addEventListener("click", () => openPalette());

  els.menu.append(icon("more", 21));
  els.menu.addEventListener("click", openMenu);
}

/** The archive menu — settings and data live here, not in the navigation. */
async function openMenu() {
  const { overlay } = await import("./ui/feedback.js");

  const sheet = overlay({ title: "Archive", size: "sm" });
  const rows = [
    { icon: "spark", label: "Surprise me", hint: "Open a random item", run: surprise },
    { icon: "star", label: "Starred", hint: `${stats().starred} saved`, run: () => {
      sheet.close();
      set({ route: "library" });
      Object.assign(state.query, { starred: true, search: "", kind: "all", author: null, unseen: false });
      location.hash = "#/library";
    } },
    { icon: "sun", label: document.documentElement.dataset.theme === "dark" ? "Light theme" : "Dark theme",
      hint: "Currently following " + state.prefs.themeMode,
      run: () => {
        setPrefs({ themeMode: document.documentElement.dataset.theme === "dark" ? "light" : "dark" });
        sheet.close();
      } },
    { icon: "eyeOff", label: state.prefs.blurMedia ? "Media is blurred" : "Blur media by default",
      hint: "Hides thumbnails until you tap them",
      run: () => { setPrefs({ blurMedia: !state.prefs.blurMedia }); sheet.close(); } },
    { icon: "database", label: "Import & export", hint: "Move your archive in and out", run: () => { sheet.close(); openManage(); } },
    { icon: "settings", label: "Settings", hint: "Theme, playback, privacy", run: () => { sheet.close(); openSettings(); } },
    { icon: "keyboard", label: "Keyboard shortcuts", hint: "Everything the keys do", run: () => { sheet.close(); showShortcuts(); } },
  ];

  for (const row of rows) {
    sheet.content.append(h("button.menu-row", { type: "button", onclick: row.run },
      h("span.menu-row__icon", icon(row.icon, 19)),
      h("span.menu-row__text",
        h("b", { text: row.label }),
        h("small", { text: row.hint }),
      ),
      icon("chevronRight", 18),
    ));
  }
}

function surprise() {
  const list = state.index.media;
  if (!list.length) return toast("Your archive is empty.");
  const item = list[Math.floor(Math.random() * list.length)];
  import("./viewer.js").then(({ openViewer }) => openViewer([item], 0));
}

async function showShortcuts() {
  const { overlay } = await import("./ui/feedback.js");
  const sheet = overlay({ title: "Keyboard shortcuts", size: "sm" });
  const keys = [
    ["/ or ⌘K", "Search everything"],
    ["1 / 2 / 3", "Home, Library, Watch"],
    ["J / K", "Next and previous item"],
    ["Enter", "Open the focused item"],
    ["S", "Star the open item"],
    ["M", "Mute or unmute"],
    ["F", "Full screen"],
    ["Space", "Play or pause"],
    ["← / →", "Seek 5 seconds"],
    ["Esc", "Close anything that is open"],
  ];
  for (const [key, what] of keys) {
    sheet.content.append(h("div.shortcut",
      h("kbd.kbd", { text: key }),
      h("span", { text: what }),
    ));
  }
}

/* -------------------------------------------------------------- routing -- */

export function navigate(id, { replace = false, back = false } = {}) {
  if (!ROUTE_IDS.includes(id)) id = "home";
  if (id === state.route && current) { renderChromeBits(); return; }

  if (current) {
    scrollMemory.set(current.id, window.scrollY);
    views[current.id]?.unmount?.();
  }

  if (els.navbar) els.navbar.dataset.prominent = "false";
  state.route = id;
  clear(els.main);
  current = ROUTES.find((r) => r.id === id);

  const mod = views[id];
  if (mod) {
    try { mod.mount(els.main); }
    catch (err) { renderViewError(err); }
  }

  /* The entering view rises on a spring; a back navigation slides in from
     the edge it came from. One animation class, removed when it finishes. */
  const view = els.main.firstElementChild;
  if (view) {
    view.classList.add("stage__view", back ? "is-in-back" : "is-in");
    view.addEventListener("animationend",
      () => view.classList.remove("is-in", "is-in-back"), { once: true });
  }

  if (!back && navStack[navStack.length - 1] !== id) navStack.push(id);

  const hash = `#/${id}`;
  if (replace) history.replaceState(null, "", hash);
  else if (location.hash !== hash) location.hash = hash;

  document.title = `${current.title} · Archive`;
  renderChromeBits();

  const y = scrollMemory.get(id) || 0;
  requestAnimationFrame(() => scrollTo({ top: y, behavior: "instant" }));
}

export function readHash() {
  const m = /^#\/(home|library|watch)/.exec(location.hash);
  return m ? m[1] : null;
}

/* ------------------------------------------------------- prominent -- */

/** Large-title views call this as their header slides under the navbar. */
export function setProminent(on) {
  if (els.navbar) els.navbar.dataset.prominent = on ? "true" : "false";
}

function renderViewError(err) {
  console.error("[view]", err);
  clear(els.main);
  els.main.append(h(".crash", { style: { minHeight: "auto", padding: "40px 16px" } },
    h(".crash__card",
      h("h1", { text: "This view failed to draw" }),
      h("p.crash__msg", { text: String(err?.message || err) }),
      h(".crash__actions",
        h("button.btn.btn--primary", {
          type: "button", text: "Go home", onclick: () => navigate("home"),
        }),
      ),
    ),
  ));
}

/* ---------------------------------------------------------------- chrome -- */

function renderChromeBits() {
  tabbar?.setActive(state.route);
  if (els.title && current) els.title.textContent = current.title;

  /* Watch is immersive: the frame gets out of the way entirely. */
  document.body.dataset.immersive = state.route === "watch" ? "true" : "false";
}

/* ------------------------------------------------- scroll-driven chrome -- */

function wireScrollChrome() {
  let frame = 0;
  addEventListener("scroll", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const y = window.scrollY;
      els.navbar.dataset.scrolled = y > 8 ? "true" : "false";

      /* The tab bar yields to reading: down hides it, up brings it back.
         Never hidden at the top, in Watch, or while a sheet is open. */
      if (isTouch() && state.route !== "watch" && !document.body.dataset.overlay) {
        const delta = y - lastScroll;
        if (y < 60 || delta < -6) setTabsHidden(false);
        else if (delta > 10) setTabsHidden(true);
      }
      lastScroll = y;
    });
  }, { passive: true });
}

function setTabsHidden(hidden) {
  if (hidingTabs === hidden) return;
  hidingTabs = hidden;
  els.tabbar.dataset.hidden = hidden ? "true" : "false";
}

/* ------------------------------------------------------------ swipe-back -- */

/**
 * The iOS edge swipe: a touch drag starting within the left edge pulls the
 * current view along 1:1, and releasing past a third of the screen (or with
 * a flick) goes back. A short drag springs home.
 *
 * Deliberately conservative: it only arms on touch pointers, at the screen
 * edge, with somewhere to go, and never while a sheet or the viewer owns
 * the screen. A vertical scroll aborts it the moment it declares itself.
 */
function wireSwipeBack() {
  const EDGE = 28;
  let tracking = false;
  let dead = false;
  let sx = 0, sy = 0, dx = 0, lastX = 0, lastT = 0, velocity = 0;
  let view = null;

  els.main.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || e.clientX > EDGE) return;
    if (document.body.dataset.overlay || document.body.dataset.viewer === "open") return;
    if (navStack.length < 2) return;
    tracking = true; dead = false;
    sx = lastX = e.clientX; sy = e.clientY; dx = 0; velocity = 0; lastT = e.timeStamp;
    view = els.main.firstElementChild;
  }, { passive: true });

  els.main.addEventListener("pointermove", (e) => {
    if (!tracking || dead) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (dx < 0) dx = 0;

    /* A vertical scroll declares itself quickly — hand the gesture back. */
    if (dy > 12 && dy > dx * 1.4) { cancelSwipe(); return; }
    if (!view || dx <= 0) return;

    const now = e.timeStamp;
    if (now > lastT) {
      velocity = 0.7 * velocity + 0.3 * ((e.clientX - lastX) / (now - lastT));
      lastX = e.clientX; lastT = now;
    }

    els.main.dataset.swiping = "true";
    const capped = Math.min(dx, window.innerWidth * 0.72);
    view.style.translate = `${capped}px 0`;
    view.style.opacity = String(1 - (capped / window.innerWidth) * 0.3);
  }, { passive: true });

  const finish = () => {
    if (!tracking) return;
    tracking = false;
    delete els.main.dataset.swiping;
    if (dead || !view) { view = null; return; }

    const w = window.innerWidth;
    if (dx > w * 0.34 || velocity > 0.55) {
      /* Commit: the view keeps travelling off-screen while history moves. */
      const v = view;
      v.style.transition = "translate 220ms cubic-bezier(0.32,0.72,0,1), opacity 220ms linear";
      v.style.translate = `${w}px 0`;
      v.style.opacity = "0.6";
      view = null;
      haptic(10);
      goBack();
    } else {
      /* Abort: spring home. */
      const v = view;
      view = null;
      v.style.transition = "translate 280ms cubic-bezier(0.32,0.72,0,1), opacity 200ms linear";
      v.style.translate = "0px 0";
      v.style.opacity = "1";
      setTimeout(() => { v.style.transition = ""; v.style.translate = ""; v.style.opacity = ""; }, 300);
    }
    dx = 0;
  };

  function cancelSwipe() {
    dead = true;
    tracking = false;
    delete els.main.dataset.swiping;
    if (view) { view.style.translate = ""; view.style.opacity = ""; view = null; }
    dx = 0;
  }

  els.main.addEventListener("pointerup", finish, { passive: true });
  els.main.addEventListener("pointercancel", cancelSwipe, { passive: true });
}

function goBack() {
  if (navStack.length < 2) return;
  navStack.pop();
  pendingBack = true;
  history.back();
}

/* -------------------------------------------------------------- hotkeys -- */

function wireKeys() {
  addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.target.closest?.(".sheet")) return;

    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); openPalette(); return;
    }
    if (typing) return;

    if (e.key === "/") { e.preventDefault(); openPalette(); return; }
    if (e.key === "1") navigate("home");
    if (e.key === "2") navigate("library");
    if (e.key === "3") navigate("watch");
    if (e.key === "?") showShortcuts();
  });

  addEventListener("hashchange", () => {
    const id = readHash();
    if (id && id !== state.route) navigate(id, { back: pendingBack });
    pendingBack = false;
  });

  /* The OS may flip colour scheme mid-session; "system" has to follow. */
  matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (state.prefs.themeMode === "system") { applyPrefs(); renderChromeBits(); }
  });
}

export function setLoadMessage(msg) {
  state.ui.loadMessage = msg;
}
