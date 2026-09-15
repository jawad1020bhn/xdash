/* =============================================================================
   shell v3 — the persistent frame: sidebar, top bar, tab bar, routing.

   Built once, never rebuilt. Views mount into #main and own their scroll
   position, which is remembered per route so returning feels like returning.
   ========================================================================== */

import { h, icon, clear, haptic, breakpoint } from "./ui/dom.js";
import { state, set, setPrefs, subscribe } from "./core/state.js";
import { stats } from "./core/query.js";
import { openPalette } from "./ui/palette.js";
import { openSettings } from "./views/settings.js";
import { openManage } from "./views/manage.js";

const ROUTES = [
  { id: "home", label: "Home", icon: "gauge", title: "Home" },
  { id: "library", label: "Library", icon: "grid", title: "Library" },
  { id: "watch", label: "Watch", icon: "play", title: "Watch" },
];

export const ROUTE_IDS = ROUTES.map((r) => r.id);

let els = {};
const views = {};
const scrollMemory = new Map();
let current = null;
let lastScroll = 0;

export function initShell(viewModules) {
  Object.assign(views, viewModules);
  els = {
    shell: document.getElementById("shell"),
    side: document.getElementById("side"),
    sideNav: document.getElementById("sideNav"),
    sideFoot: document.getElementById("sideFoot"),
    topbar: document.getElementById("topbar"),
    topTitle: document.getElementById("topTitleText"),
    tabbar: document.getElementById("tabbar"),
    main: document.getElementById("main"),
    palette: document.getElementById("openPalette"),
    theme: document.getElementById("themeToggle"),
    menu: document.getElementById("menuBtn"),
  };

  buildNav();
  buildSideFoot();
  wireHeader();
  wireScrollChrome();
  wireKeys();

  els.shell.hidden = false;
  document.getElementById("boot")?.remove();

  subscribe(renderChrome);
  renderChrome();
}

/* ------------------------------------------------------------------ nav -- */

/* Hovering a destination warms its module, so the tap is instant. */
const warmed = new Set();
function prefetch(id) {
  if (warmed.has(id)) return;
  warmed.add(id);
  import(`./views/${id}.js`).catch(() => {});
}


function buildNav() {
  clear(els.sideNav);
  clear(els.tabbar);

  for (const route of ROUTES) {
    const badge = h("span.badge.t-num", { text: "" });
    const side = h("button.side__item", {
      type: "button", dataset: { route: route.id },
      onclick: () => tap(route.id),
      onpointerenter: () => prefetch(route.id),
      onfocus: () => prefetch(route.id),
    }, icon(route.icon, 20), h("span", { text: route.label }), badge);
    els.sideNav.append(side);

    const tab = h("button.tab", {
      type: "button", dataset: { route: route.id },
      "aria-label": route.title,
      onclick: () => tap(route.id),
      onpointerenter: () => prefetch(route.id),
      onfocus: () => prefetch(route.id),
    }, icon(route.icon, 22), h("span", { text: route.label }));
    els.tabbar.append(tab);
  }

  function tap(id) {
    haptic(8);
    if (state.route === id) { scrollTo({ top: 0, behavior: "smooth" }); return; }
    navigate(id);
  }
}

function buildSideFoot() {
  clear(els.sideFoot);
  els.sideFoot.append(
    h("div.side__stats.t-num", { "aria-live": "polite" }),
    h("button.side__item", { type: "button", onclick: () => openSettings() },
      icon("settings", 20), h("span", { text: "Settings" })),
    h("button.side__item", { type: "button", onclick: () => openManage() },
      icon("database", 20), h("span", { text: "Import & export" })),
  );
}

function wireHeader() {
  els.palette.querySelector(".topbar__search-icon")?.append(icon("search", 17));
  els.palette.addEventListener("click", () => openPalette());
  els.theme.addEventListener("click", toggleTheme);
  els.menu.append(icon("more", 20));
  els.menu.addEventListener("click", openMenu);
}

export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  setPrefs({ themeMode: dark ? "light" : "dark" });
  haptic(6);
}

/* ----------------------------------------------------------------- menu -- */

async function openMenu() {
  const { overlay } = await import("./ui/feedback.js");
  const sheet = overlay({ title: "Archive", size: "sm" });

  const rows = [
    { icon: "spark", hue: "var(--hue-a)", label: "Random item", hint: "Open one at random", run: surprise },
    { icon: "star", hue: "var(--hue-e)", label: "Starred", hint: `${stats().starred} starred`, run: () => {
      sheet.close();
      set({ route: "library" });
      Object.assign(state.query, { starred: true, search: "", kind: "all", author: null, unseen: false });
      location.hash = "#/library";
    } },
    { icon: document.documentElement.dataset.theme === "dark" ? "sun" : "moon", hue: "var(--hue-d)",
      label: document.documentElement.dataset.theme === "dark" ? "Light theme" : "Dark theme",
      hint: `Mode: ${state.prefs.themeMode}`, run: () => { sheet.close(); toggleTheme(); } },
    { icon: "eyeOff", hue: "var(--hue-c)", label: state.prefs.blurMedia ? "Media is blurred" : "Blur media", hint: "Blur thumbnails until tapped",
      run: () => { setPrefs({ blurMedia: !state.prefs.blurMedia }); sheet.close(); } },
    { icon: "database", hue: "var(--hue-b)", label: "Import & export", hint: "Move your archive in and out", run: () => { sheet.close(); openManage(); } },
    { icon: "settings", hue: "var(--hue-f)", label: "Settings", hint: "Theme, density, playback, privacy", run: () => { sheet.close(); openSettings(); } },
    { icon: "keyboard", hue: "var(--hue-c)", label: "Keyboard shortcuts", hint: "Full list", run: () => { sheet.close(); showShortcuts(); } },
  ];

  for (const row of rows) {
    sheet.content.append(h("button.menu-row.hue", { type: "button", style: { "--hue": row.hue }, onclick: row.run },
      h("span.menu-row__icon", icon(row.icon, 18)),
      h("span.menu-row__text", h("b", { text: row.label }), h("small", { text: row.hint })),
      icon("chevronRight", 16),
    ));
  }
}

function surprise() {
  const list = state.index.media;
  if (!list.length) return import("./ui/feedback.js").then(({ toast }) => toast("Your archive is empty."));
  const item = list[Math.floor(Math.random() * list.length)];
  import("./viewer.js").then(({ openViewer }) => openViewer([item], 0));
}

export async function showShortcuts() {
  const { overlay } = await import("./ui/feedback.js");
  const sheet = overlay({ title: "Keyboard shortcuts", size: "sm" });
  const keys = [
    ["/ or ⌘K", "Search everything"],
    ["1 / 2 / 3", "Home, Library, Watch"],
    ["S", "Star the open item"],
    ["J / K", "Next and previous item"],
    ["Space", "Play or pause"],
    ["M", "Mute or unmute"],
    ["F", "Full screen"],
    ["← / →", "Seek 5 seconds"],
    ["Esc", "Close anything open"],
  ];
  for (const [key, what] of keys) sheet.content.append(h("div.shortcut", h("kbd.kbd", { text: key }), h("span", { text: what })));
}

/* -------------------------------------------------------------- routing -- */

export function navigate(id, { replace = false } = {}) {
  if (!ROUTE_IDS.includes(id)) id = "home";
  if (id === state.route && current) { renderChrome(); return; }

  if (current) {
    scrollMemory.set(current.id, window.scrollY);
    views[current.id]?.unmount?.();
  }

  state.route = id;
  clear(els.main);
  current = ROUTES.find((r) => r.id === id);

  try { views[id]?.mount(els.main); }
  catch (err) { renderViewError(err); }

  const hash = `#/${id}`;
  if (replace) history.replaceState(null, "", hash);
  else if (location.hash !== hash) location.hash = hash;

  document.title = `${current.title} · Archive`;
  document.body.dataset.route = id;
  renderChrome();

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
  els.main.append(h("div.crash", { style: { minHeight: "auto", padding: "40px 16px" } },
    h("div.crash__card",
      h("h1", { text: "This view failed to draw" }),
      h("p.crash__msg", { text: String(err?.message || err) }),
      h("div.crash__actions",
        h("button.btn.btn--pri", { type: "button", text: "Go home", onclick: () => navigate("home") })),
    ),
  ));
}

/* --------------------------------------------------------------- chrome -- */

function renderChrome() {
  const s = stats();
  for (const item of [...els.sideNav.children, ...els.tabbar.children]) {
    const active = item.dataset.route === state.route;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
    const badge = item.querySelector(".badge");
    if (badge) {
      badge.textContent = item.dataset.route === "library" && s.media ? fmtK(s.media) : "";
      badge.hidden = !badge.textContent;
    }
  }

  els.topTitle.textContent = ROUTES.find((r) => r.id === state.route)?.title || "Home";

  const foot = els.sideFoot?.querySelector(".side__stats");
  if (foot) {
    foot.replaceChildren(
      s.media ? h("span", {}, h("b", { text: fmtK(s.media) }), " items · ", h("b", { text: fmtK(s.creators) }), " creators")
        : "No archive loaded",
    );
  }

  const wide = breakpoint() !== "compact";
  els.palette.querySelector(".topbar__search-label").textContent = "Search";
  const kbd = els.palette.querySelector(".kbd");
  if (kbd) kbd.hidden = !wide;
  if (kbd) kbd.textContent = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘K" : "Ctrl K";

  const dark = document.documentElement.dataset.theme === "dark";
  els.theme.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  els.theme.replaceChildren(icon(dark ? "sun" : "moon", 19));
}

const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/* ------------------------------------------------- scroll-driven chrome -- */

function wireScrollChrome() {
  let frame = 0;
  addEventListener("scroll", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const y = window.scrollY;
      els.topbar.dataset.scrolled = y > 8 ? "true" : "false";
      lastScroll = y;
    });
  }, { passive: true });
}

/* -------------------------------------------------------------- hotkeys -- */

function wireKeys() {
  addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.target.closest?.(".sheet, .pal, .vw, .watch")) return;

    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPalette(); return; }
    if (typing) return;

    if (e.key === "/") { e.preventDefault(); openPalette(); return; }
    if (e.key === "1") navigate("home");
    if (e.key === "2") navigate("library");
    if (e.key === "3") navigate("watch");
    if (e.key === "?") showShortcuts();
  });

  addEventListener("hashchange", () => {
    const id = readHash();
    if (id && id !== state.route) navigate(id);
  });

  matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (state.prefs.themeMode === "system") { setPrefs({}); }
  });
}
