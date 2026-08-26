/* =============================================================================
   shell — the persistent frame: top bar, navigation, routing.

   The frame is built once and never rebuilt. Views mount into #main and own
   their own scroll position, which is remembered per route.
   ============================================================================= */

import { h, icon, clear, onBreakpoint, isTouch, haptic } from "./ui/dom.js";
import { state, set, setPrefs, applyPrefs, subscribe } from "./core/state.js";
import { stats } from "./core/query.js";
import { toast } from "./ui/feedback.js";
import { openPalette } from "./ui/palette.js";
import { openSettings } from "./views/settings.js";
import { openManage } from "./views/manage.js";

const ROUTES = [
  { id: "home", label: "Home", icon: "home", title: "Home" },
  { id: "library", label: "Library", icon: "grid", title: "Library" },
  { id: "watch", label: "Watch", icon: "play", title: "Watch" },
];

export const ROUTE_IDS = ROUTES.map((r) => r.id);

let els = {};
const views = {};
const scrollMemory = new Map();
let current = null;
let lastScroll = 0;
let hidingNav = false;

export function initShell(viewModules) {
  Object.assign(views, viewModules);
  els = {
    shell: document.getElementById("shell"),
    topbar: document.getElementById("topbar"),
    nav: document.getElementById("nav"),
    main: document.getElementById("main"),
    boot: document.getElementById("boot"),
    palette: document.getElementById("openPalette"),
    theme: document.getElementById("themeToggle"),
    menu: document.getElementById("menuBtn"),
  };

  buildNav();
  wireHeader();
  wireScrollChrome();
  wireKeys();

  els.shell.hidden = false;
  els.boot?.remove();

  /* The nav's visibility rules depend on the breakpoint, and the top bar's
     search label changes with it. One subscription, both concerns. */
  onBreakpoint(() => renderChromeBits());
  subscribe(() => renderChromeBits());
  renderChromeBits();
}

function buildNav() {
  clear(els.nav);
  for (const route of ROUTES) {
    const item = h("button.nav__item", {
      type: "button",
      dataset: { route: route.id },
      "aria-label": route.title,
      onclick: () => {
        haptic(8);
        if (state.route === route.id) {
          /* Tapping the tab you are already on returns you to its top. This is
             the one gesture every phone user expects and rarely finds. */
          scrollTo(0, 0);
          return;
        }
        navigate(route.id);
      },
    },
      icon(route.icon, 22),
      h("span", { text: route.label }),
    );
    els.nav.append(item);
  }
}

function wireHeader() {
  els.palette.querySelector(".topbar__search-icon")
    .append(icon("search", 18));

  els.palette.addEventListener("click", () => openPalette());

  els.theme.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    setPrefs({ themeMode: dark ? "light" : "dark" });
    haptic(6);
  });

  els.menu.append(icon("more", 22));
  els.menu.addEventListener("click", openMenu);
}

/** The archive menu — settings and data live here, not in the navigation. */
async function openMenu() {
  const { overlay } = await import("./ui/feedback.js");
  const { openViewer } = await import("./viewer.js");
  void openViewer;

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

export function navigate(id, { replace = false } = {}) {
  if (!ROUTE_IDS.includes(id)) id = "home";
  if (id === state.route && current) { renderChromeBits(); return; }

  if (current) {
    scrollMemory.set(current.id, window.scrollY);
    views[current.id]?.unmount?.();
  }

  state.route = id;
  clear(els.main);
  current = ROUTES.find((r) => r.id === id);

  const mod = views[id];
  if (mod) {
    try { mod.mount(els.main); }
    catch (err) { renderViewError(err); }
  }

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
  for (const item of els.nav.children) {
    const active = item.dataset.route === state.route;
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  const wide = !document.documentElement.dataset.bp || document.documentElement.dataset.bp !== "compact";
  els.palette.querySelector(".topbar__search-label").textContent =
    wide ? "Search posts, creators, anything" : "Search";
  els.palette.querySelector(".topbar__search-kbd").textContent =
    navigator.platform?.includes("Mac") ? "⌘K" : "Ctrl K";

  const dark = document.documentElement.dataset.theme === "dark";
  els.theme.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  els.theme.replaceChildren(icon(dark ? "sun" : "moon", 20));

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
      els.topbar.dataset.scrolled = y > 8 ? "true" : "false";

      /* The bottom bar yields to reading: down hides it, up brings it back.
         Never hidden at the top, in Watch, or while a sheet is open. */
      if (isTouch() && state.route !== "watch" && !document.body.dataset.overlay) {
        const delta = y - lastScroll;
        if (y < 60 || delta < -6) setNavHidden(false);
        else if (delta > 10) setNavHidden(true);
      }
      lastScroll = y;
    });
  }, { passive: true });
}

function setNavHidden(hidden) {
  if (hidingNav === hidden) return;
  hidingNav = hidden;
  els.nav.dataset.hidden = hidden ? "true" : "false";
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
    if (e.key === "?" || (e.key === "/" && e.shiftKey)) showShortcuts();
  });

  addEventListener("hashchange", () => {
    const id = readHash();
    if (id && id !== state.route) navigate(id);
  });

  /* The OS may flip colour scheme mid-session; "system" has to follow. */
  matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (state.prefs.themeMode === "system") { applyPrefs(); renderChromeBits(); }
  });
}

export function setLoadMessage(msg) {
  state.ui.loadMessage = msg;
}
