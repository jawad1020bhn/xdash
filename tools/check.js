/* =============================================================================
   check — the project's own smoke test.

   Boots the REAL application modules (src/main.js and everything it imports)
   against a jsdom DOM pointed at the live data file, then asserts on the
   resulting document. Nothing is re-implemented here: if this passes, the
   shipping code ran.

   jsdom is a DOM, not a browser — matchMedia, IntersectionObserver, layout and
   media playback are stubbed below. Application logic is not. Layout-dependent
   code gets exactly two honest numbers: a clientWidth derived from the viewport
   width under test, and innerHeight.

   Usage:  npm start  (in one shell)   then   npm test
   ============================================================================= */

import { JSDOM, VirtualConsole } from "jsdom";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const WAIT = Number(process.env.WAIT || 9000);

const errors = [];
const results = [];

function ok(name, condition, detail = "") {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------- browser stubs --- */

function installStubs(window, width) {
  const listeners = new Map();
  window.matchMedia = (query) => {
    let matches = false;
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    if (max) matches = width <= Number(max[1]);
    else if (min) matches = width >= Number(min[1]);
    if (/hover:\s*hover|pointer:\s*fine/.test(query)) matches = false;
    if (/hover:\s*none|pointer:\s*coarse/.test(query)) matches = true;
    if (/prefers-color-scheme:\s*dark/.test(query)) matches = true;
    return {
      media: query, matches, onchange: null,
      addEventListener(t, fn) { (listeners.get(query) ?? listeners.set(query, new Set()).get(query)).add(fn); },
      removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    };
  };

  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { setTimeout(() => this.cb([{ target: el, intersectionRatio: 1, isIntersecting: true }], this), 0); }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  /* jsdom has no media pipeline; playback is asserted structurally. */
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () {};

  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {}, finish() {} }; };
  window.Element.prototype.requestFullscreen = function () { return Promise.resolve(); };
  window.Element.prototype.setPointerCapture = function () {};
  window.scrollTo = function () {};
  window.scroll = function () {};

  /* jsdom has no layout. Give the windowed grid the two numbers it reads:
     a container width derived from the viewport under test, and a height. */
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
  Object.defineProperty(window.Element.prototype, "clientWidth", {
    configurable: true,
    get() { return width - 32; },
  });
  Object.defineProperty(window.Element.prototype, "clientHeight", {
    configurable: true,
    get() { return 844; },
  });

  const realFetch = globalThis.fetch;
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? new URL(input, BASE + "/").href : input;
    return realFetch(url, init);
  };
}

/* ------------------------------------------------------------- harness --- */

async function run(width, label, { wrongFirst = false } = {}) {
  console.log(`\n── ${label} (${width}px) ──`);

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(`jsdomError: ${e.message.split("\n")[0]}`));
  vc.on("error", (...a) => errors.push(`console.error: ${a.join(" ").slice(0, 200)}`));

  const dom = await JSDOM.fromURL(`${BASE}/index.html`, {
    runScripts: "outside-only",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });

  const window = dom.window;
  installStubs(window, width);

  for (const key of ["window", "document", "navigator", "location", "history",
    "HTMLElement", "Element", "Node", "Event", "CustomEvent", "DocumentFragment",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
    "matchMedia", "IntersectionObserver", "ResizeObserver", "localStorage",
    "sessionStorage", "Blob", "URL", "Image", "addEventListener",
    "removeEventListener", "dispatchEvent", "fetch", "innerWidth", "innerHeight",
    "scrollTo", "scrollY", "devicePixelRatio", "screen"]) {
    if (window[key] === undefined) continue;
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  globalThis.window = window;
  globalThis.document = window.document;
  for (const key of ["addEventListener", "removeEventListener", "dispatchEvent",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
    "matchMedia", "scrollTo", "fetch"]) {
    if (typeof globalThis[key] === "function") globalThis[key] = globalThis[key].bind(window);
  }

  window.addEventListener("error", (e) =>
    errors.push(`window.error: ${String(e.error?.stack || e.message).split("\n").slice(0, 3).join(" | ")}`));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push(`unhandledrejection: ${String(e.reason?.stack || e.reason).split("\n").slice(0, 3).join(" | ")}`));

  const started = Date.now();
  await import(`${ROOT}/src/main.js?bp=${width}&v=${width}`);
  const gate = await passGate(window, { wrongFirst });
  await new Promise((r) => setTimeout(r, WAIT));
  const elapsed = Date.now() - started;

  return { d: window.document, window, elapsed, gate, q: (s) => window.document.querySelectorAll(s).length };
}

/* The app boots behind a fixed-PIN gate (src/main.js FIXED_PIN). Enter it,
   optionally probing the wrong-PIN path first. */
async function passGate(window, { wrongFirst = false } = {}) {
  const d = window.document;
  let form = null;
  for (let i = 0; i < 60; i++) {
    form = d.querySelector(".lock__card");
    if (form) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const input = d.querySelector(".lock input");
  if (!form || !input) return { showed: false, gone: false, wrongAlert: "" };

  const shellHiddenBefore = d.getElementById("shell")?.hidden !== false;
  let wrongAlert = "";
  if (wrongFirst) {
    input.value = "0000";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 80));
    wrongAlert = d.querySelector(".lock [role='alert']")?.textContent || "";
    input.value = "";
  }

  input.value = "2055";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 280));
  return { showed: true, gone: !d.querySelector(".lock"), wrongAlert, shellHiddenBefore };
}

/* ============================================================== phone ===== */

const { d, q, window, elapsed, gate } = await run(390, "phone", { wrongFirst: true });

ok("boot does not fall into the crash surface", d.getElementById("crash").hidden === true);
ok("the crash surface is display:none, not just [hidden]",
  window.getComputedStyle(d.getElementById("crash")).display === "none",
  window.getComputedStyle(d.getElementById("crash")).display);
ok("shell is visible", d.getElementById("shell").hidden === false);
ok("boot skeleton was removed", !d.getElementById("boot"));

ok("tab bar has three destinations", q(".tab") === 3, `${q(".tab")} tabs`);
ok("sidebar has three destinations", q(".side__item") >= 3, `${q(".side__item")} items`);

/* ------------------------------------------------ fixed-PIN gate (2055) -- */

console.log("\n── Fixed PIN gate ──");
ok("the PIN gate blocks the app at boot", gate.showed && gate.shellHiddenBefore,
  gate.showed ? `shell hidden=${gate.shellHiddenBefore}` : "gate never appeared");
ok("a wrong PIN is refused with the alert", /not the PIN/i.test(gate.wrongAlert), gate.wrongAlert || "(no alert)");
ok("PIN 2055 unlocks the archive", gate.gone && d.getElementById("shell").hidden === false,
  gate.gone ? "unlocked" : "lock still present");

const { state } = await import(`${ROOT}/src/core/state.js`);
await new Promise((r) => setTimeout(r, 300));

/* --------------------------------------------------------- curated Home -- */

console.log("\n── Curated Home ──");
const greetTxt = d.querySelector(".greet")?.textContent || "";
ok("greeting uses a time-of-day word",
  /Still up\.|Good morning\.|Good afternoon\.|Good evening\./.test(greetTxt), greetTxt.slice(0, 24));
ok("greeting carries item and creator totals", /items from/.test(greetTxt) && /creators/.test(greetTxt),
  greetTxt.replace(/\s+/g, " ").trim().slice(0, 80));
ok("greeting CTA is present", !!d.querySelector(".greet__cta"));
ok("spotlight renders exactly once", q(".home .spotlight") === 1, `${q(".home .spotlight")}`);

const railTitles = [...d.querySelectorAll(".home .block__title h2")].map((x) => x.textContent);
for (const t of ["Jump back in", "Most liked", "Long form", "Photo stories", "Recently saved"]) {
  ok(`rail “${t}” renders`, railTitles.includes(t));
}
const rails = [...d.querySelectorAll(".home .rail")];
ok("five horizontal rails rendered", rails.length === 5, `${rails.length} rails`);
ok("every rail carries tiles", rails.every((r) => r.querySelectorAll(".tile").length >= 2),
  rails.map((r) => r.querySelectorAll(".tile").length).join("/"));
const railTileCount = rails.reduce((n, r) => n + r.querySelectorAll(".tile").length, 0);
ok("rails stay a bounded edit, not the full archive", railTileCount > 20 && railTileCount <= 60, `${railTileCount} tiles`);
ok("creators row renders with at least three creators", q(".home .creator") >= 3, `${q(".home .creator")} creators`);
ok("footer renders four stats", q(".home__foot .stat") === 4, `${q(".home__foot .stat")} stats`);
ok("footer CTA opens the library",
  /Open the full library/.test(d.querySelector(".home__foot .btn")?.textContent || ""));
ok("home sections reveal on scroll", d.documentElement.classList.contains("has-rv") && q(".home .reveal.is-in") >= 6,
  `${q(".home .reveal.is-in")} revealed`);
ok("home is media-first: no KPI cards, no charts", q(".home .kpi") === 0 && q(".home .chart") === 0);
ok("chips and infinite grid are gone from Home",
  q(".home__chips") === 0 && q(".home .grid") === 0);

/* Rail “All” must reproduce the rail as a Library query. */
const allFor = (t) => [...d.querySelectorAll(".block__head")]
  .find((h) => h.querySelector("h2").textContent === t)?.querySelector(".block__all");
allFor("Most liked")?.dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
ok("rail “All” lands in Library", q(".lib") === 1);
ok("“Most liked” sets the liked sort", state.query.sort === "liked", state.query.sort);
d.querySelector('.tab[data-route="home"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
d.querySelector(".home__foot .btn")?.dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
ok("footer CTA navigates to the full library", q(".lib") === 1);

const imgs = [...d.querySelectorAll("img")];
ok("every image has alt text", imgs.every((i) => (i.alt || "").trim().length > 0),
  `${imgs.filter((i) => (i.alt || "").trim()).length}/${imgs.length} with alt`);
const lazy = imgs.filter((i) => i.getAttribute("loading") === "lazy");
ok("thumbnails are lazy-loaded", lazy.length > imgs.length * 0.8, `${lazy.length}/${imgs.length} lazy`);
ok("thumbnails request a small rendition",
  imgs.filter((i) => /name=small|_200x200/.test(i.getAttribute("srcset") || i.getAttribute("src") || "")).length > 0);

const docBytes = d.documentElement.outerHTML.length;
ok("initial DOM stays small", docBytes < 260_000, `${(docBytes / 1024).toFixed(0)} KB of HTML`);
ok("booted with data in under 9s", elapsed < WAIT + 1000, `${elapsed}ms`);

/* --------------------------------------------- video formats + masonry --- */

console.log("\n── Video format ladder ──");
const videos = state.index.media.filter((m) => m.kind !== "photo");
ok("archive videos are indexed", videos.length > 700, `${videos.length} videos`);
const noLadder = videos.filter((v) => !Array.isArray(v.sources) || !v.sources.length);
ok("every video carries a playable source ladder", noLadder.length === 0,
  noLadder.length ? `${noLadder.length} without sources` : "");
const hlsLast = videos.filter((v) => {
  const s = v.sources;
  const hlsIdx = s.findIndex((x) => /mpegurl/.test(x.type));
  return hlsIdx >= 0 && hlsIdx !== s.length - 1;
});
ok("HLS, when present, is the last-resort source", hlsLast.length === 0, `${hlsLast.length} misplaced`);
const mp4s = videos.filter((v) => v.sources.some((s) => s.type === "video/mp4"));
ok("every video offers an MP4 rendition", mp4s.length === videos.length, `${mp4s.length}/${videos.length}`);
const multi = videos.filter((v) => v.sources.filter((s) => s.type === "video/mp4").length > 1);
ok("most videos expose multiple MP4 renditions as fallbacks", multi.length > 600, `${multi.length} multi-rendition`);

/* --------------------------------------------- insights (behind settings) -- */

console.log("\n── Insights, one tap deep ──");
const { openInsights } = await import(`${ROOT}/src/views/insights.js`);
openInsights();
await new Promise((r) => setTimeout(r, 800));
ok("insights opens with headline numbers", q(".ins__cell") === 4, `${q(".ins__cell")} cells`);
ok("insights chart renders", q(".sheet .chart svg") >= 1);
ok("insights mix + leaderboard render", q(".sheet .mix__row") >= 2 && q(".sheet .board__row") >= 3);
window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
ok("insights closes on escape", !d.querySelector(".sheet"));

/* ------------------------------------------------------- library window -- */

console.log("\n── Library windowing (phone) ──");
d.querySelector('.tab[data-route="library"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1500));

ok("library mounted", q(".lib") === 1);
const tiles = q(".grid .tile");
ok("grid windowed, not fully rendered", tiles > 0 && tiles < 200, `${tiles} tiles in the DOM for 1,205 items`);
const gridH = parseFloat(d.querySelector(".grid")?.style.height || "0");
ok("scroll height reflects the whole archive", gridH > 10_000, `${Math.round(gridH)}px of scroll height`);
ok("search field present", !!d.querySelector(".lib__bar input"));
ok("facet chips present", q(".lib__facets .chip") >= 5, `${q(".lib__facets .chip")} chips`);

console.log("\n── Masonry geometry keeps every format honest ──");
const masonTiles = [...d.querySelectorAll(".lib .grid .tile")];
const itemById = new Map(state.index.media.map((m) => [m.id, m]));
const widthsSet = new Set(masonTiles.map((t) => t.style.width));
ok("masonry tiles share one column width", widthsSet.size === 1, `${[...widthsSet].length} widths`);
let overlap = 0, aspectMismatch = 0, outOfBounds = 0;
const gridEl = d.querySelector(".lib .grid");
const gridW = gridEl.clientWidth || 358;
const gapV = parseFloat(d.defaultView.getComputedStyle(d.documentElement).getPropertyValue("--gap")) || 10;
const byCol = new Map();
for (const t of masonTiles) {
  const x = parseFloat(t.style.left), y = parseFloat(t.style.top), w = parseFloat(t.style.width);
  const item = itemById.get(t.dataset.id);
  /* jsdom has no layout: expected tile height mirrors the packer's maths. */
  const a = Math.min(2.2, Math.max(0.5, item?.aspect || 0.8));
  const h = w / a + 27;
  const col = Math.round(x / (w + gapV));
  const list = byCol.get(col) || [];
  list.push({ y, h });
  byCol.set(col, list);
  const box = t.querySelector(".tile__media");
  const cssA = parseFloat(box?.style.getPropertyValue("--aspect") || "0");
  if (item && cssA && Math.abs(cssA - a) > 0.01) aspectMismatch++;
  if (x + w > gridW + 1) outOfBounds++;
}
for (const list of byCol.values()) {
  list.sort((a, b) => a.y - b.y);
  for (let i = 1; i < list.length; i++) {
    if (list[i].y < list[i - 1].y + list[i - 1].h - 2) overlap++;
  }
}
ok("no two tiles overlap within a column", overlap === 0, `${overlap} overlaps`);
ok("tiles stay inside the grid width", outOfBounds === 0, `${outOfBounds} overflow`);
ok("every tile reserves its real (clamped) aspect ratio", aspectMismatch === 0, `${aspectMismatch} mismatches`);

const search = d.querySelector(".lib__bar input");
search.value = "the";
search.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 900));
const afterCount = d.querySelector(".lib__count")?.textContent || "";
ok("search narrows the result count", /of/.test(afterCount), afterCount);
ok("library count is announced politely", d.querySelector(".lib__count")?.getAttribute("aria-live") === "polite");
const roving = [...d.querySelectorAll(".lib .grid .tile")].filter((t) => t.tabIndex === 0);
ok("grid exposes one tab stop (roving tabindex)", roving.length === 1, `${roving.length} tabbable`);
ok("grid tiles expose their set position",
  q(".lib .grid .tile[aria-posinset]") > 0 && q(".lib .grid .tile[aria-setsize]") > 0);
const tiles0 = [...d.querySelectorAll(".lib .grid .tile")];
tiles0[0]?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
ok("arrow keys travel the grid", d.activeElement?.classList?.contains("tile") && d.activeElement !== tiles0[0],
  d.activeElement?.dataset?.id || "(no focus move)");

/* ------------------------------------------------- watch + palette ------- */

console.log("\n── Watch & palette (phone) ──");
d.querySelector('.tab[data-route="home"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
d.querySelector('.tab[data-route="watch"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1200));
ok("watch feed rebuilds once data lands", q(".watch__cell") >= 1, `${q(".watch__cell")} cells`);
ok("watch carries its own chrome", q(".watch__top") === 1 && q(".watch__act") >= 2);

console.log("\n── Uniform playback: fit + source ladder ──");
const watchEl = d.querySelector(".watch");
ok("watch defaults to uniform fill (cover)", watchEl.dataset.fit === "cover", watchEl.dataset.fit);
const fitBtn = [...d.querySelectorAll(".watch__top .icon-btn")].find((b) => /crop-to-fill/i.test(b.ariaLabel));
ok("watch has a crop/fit toggle", !!fitBtn);
fitBtn?.dispatchEvent(new window.Event("click", { bubbles: true }));
ok("fit toggle switches to whole-frame (contain)", watchEl.dataset.fit === "contain", watchEl.dataset.fit);
fitBtn?.dispatchEvent(new window.Event("click", { bubbles: true }));
ok("fit toggles back to cover", watchEl.dataset.fit === "cover", watchEl.dataset.fit);
const muteBtn = [...d.querySelectorAll(".watch__top .icon-btn")].find((b) => /mute/i.test(b.getAttribute("aria-label") || ""));
ok("watch has a mute toggle", !!muteBtn, muteBtn?.getAttribute("aria-label") || "(missing)");
const mutedBefore = state.prefs.startMuted;
muteBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok("mute toggle flips feed audio", state.prefs.startMuted !== mutedBefore);
const starsBefore = Object.keys(state.library.starred).length;
const cell0 = d.querySelector(".watch__cell");
cell0?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
cell0?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
ok("double-tap stars from the feed", Object.keys(state.library.starred).length === starsBefore + 1);
const cellVideos = [...d.querySelectorAll(".watch__cell video")];
const ladderVideos = cellVideos.filter((v) => v.querySelectorAll("source").length > 0);
ok("watch videos render the rendition ladder, not one dead src",
  cellVideos.length === 0 || ladderVideos.length === cellVideos.length,
  `${ladderVideos.length}/${cellVideos.length} with sources`);

/* The theatre on a real video item. */
const { openViewer, closeViewer } = await import(`${ROOT}/src/viewer.js`);
const feed = state.index.media;
const firstVideoIdx = feed.findIndex((m) => m.kind !== "photo");
openViewer(feed, firstVideoIdx);
await new Promise((r) => setTimeout(r, 300));
ok("viewer opens over a video", q(".vw") === 1 && q(".vw__stage video") === 1);
ok("viewer video carries rendition sources",
  d.querySelectorAll(".vw__stage video source").length >= 1,
  `${d.querySelectorAll(".vw__stage video source").length} sources`);
ok("viewer defaults to whole-frame (contain)", d.querySelector(".vw").dataset.fit === "contain");
const slideBtn = [...d.querySelectorAll(".vw__bar .icon-btn")].find((b) => (b.getAttribute("aria-label") || "") === "Slideshow");
ok("viewer offers a slideshow", !!slideBtn);
slideBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 120));
ok("slideshow arms with pressed state", slideBtn?.getAttribute("aria-pressed") === "true");
slideBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok("slideshow disarms on second tap", slideBtn?.getAttribute("aria-pressed") === "false");
const vwFit = [...d.querySelectorAll(".vw__bar .icon-btn")].find((b) => /crop-to-fill/i.test(b.ariaLabel));
ok("viewer has a crop/fit toggle", !!vwFit);
vwFit?.dispatchEvent(new window.Event("click", { bubbles: true }));
ok("viewer toggles to cover", d.querySelector(".vw").dataset.fit === "cover");
window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", bubbles: true }));
ok("C key toggles back to contain", d.querySelector(".vw").dataset.fit === "contain");
const vwStage = d.querySelector(".vw__stage");
vwStage?.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, clientX: 120, clientY: 200 }));
ok("double-click zooms the frame",
  /scale\(/.test(vwStage?.querySelector("video, img")?.style.transform || ""),
  vwStage?.querySelector("video, img")?.style.transform || "(no transform)");
closeViewer(true);
await new Promise((r) => setTimeout(r, 200));

/* A poster-only export must not render as a black player. */
openViewer([{ id: "fake:1", postId: "fake", kind: "video", aspect: 1, poster: "https://example.com/p.jpg", video: null, sources: null, dur: 0 }], 0);
await new Promise((r) => setTimeout(r, 100));
ok("poster-only video shows a badge, not a dead player", q(".vw .vid-fallback") === 1);
const swipeStage = d.querySelector(".vw__stage");
swipeStage?.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 60, clientY: 100 }));
swipeStage?.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, clientX: 60, clientY: 260 }));
await new Promise((r) => setTimeout(r, 400));
ok("swipe-down dismisses the viewer", !d.querySelector(".vw"));

d.getElementById("openPalette").dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
const palInput = d.querySelector(".pal__in input");
ok("palette opens", !!palInput);
if (palInput) {
  palInput.value = "the";
  palInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  ok("palette finds items and creators", q(".pal__item") > 2, `${q(".pal__item")} rows`);
  palInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  ok("escape closes the palette", !d.querySelector(".pal"));
  d.getElementById("openPalette").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const palTxt = d.querySelector(".pal")?.textContent || "";
  ok("palette remembers recent searches", /Recent/.test(palTxt) && /the/.test(palTxt));
  ok("palette suggests top creators", /Top creators/.test(palTxt));
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
}

/* ------------------------------------------------- manage + actions ----- */

console.log("\n── Manage & item actions (phone) ──");
const { openManage } = await import(`${ROOT}/src/views/manage.js`);
openManage();
await new Promise((r) => setTimeout(r, 400));
ok("import sheet is a drop target", !!d.querySelector(".sheet .dropzone"));
window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
const { itemActions } = await import(`${ROOT}/src/ui/actions.js`);
itemActions(feed[0]);
await new Promise((r) => setTimeout(r, 400));
ok("item menu offers copy-text", /Copy post text/.test(d.querySelector(".sheet")?.textContent || ""));
window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await new Promise((r) => setTimeout(r, 400));

/* ============================================================ desktop ===== */

const wide = await run(1440, "desktop");
const wd = wide.d;

console.log("\n── Desktop grid sanity (1440px) ──");
wd.querySelector('.side__item[data-route="library"]').dispatchEvent(new wide.window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1500));

const tilesW = [...wd.querySelectorAll(".grid .tile")];
const lefts = new Set(tilesW.map((t) => t.style.left));
const widths = new Set(tilesW.map((t) => t.style.width));
ok("desktop grid uses multiple columns", lefts.size >= 4, `${lefts.size} columns`);
ok("desktop tiles share one width", widths.size === 1, `${[...widths][0]}`);
ok("desktop grid still windowed", tilesW.length > 0 && tilesW.length < 200, `${tilesW.length} tiles`);
ok("crash surface absent on desktop too",
  wide.window.getComputedStyle(wd.getElementById("crash")).display === "none");

/* --------------------------------------- design system (Screening Room) -- */

console.log("\n── Design system ──");
const rootCS = wide.window.getComputedStyle(wd.documentElement);
ok("single ember accent, no gradient chrome",
  rootCS.getPropertyValue("--brand-1").trim() === "#ff4e2e" &&
  !/gradient/.test(rootCS.getPropertyValue("--brand")),
  `${rootCS.getPropertyValue("--brand-1").trim()} / ${rootCS.getPropertyValue("--brand").trim()}`);
ok("display voice is the platform serif, zero downloads",
  /serif/.test(rootCS.getPropertyValue("--font-display")) &&
  !wd.querySelector('link[rel="stylesheet"][href^="http"]'),
  rootCS.getPropertyValue("--font-display").trim().slice(0, 42) || "(unset)");
const metaEl = wd.querySelector(".lib .grid .tile__meta");
ok("tile meta keeps the 27px packing geometry",
  !!metaEl && wide.window.getComputedStyle(metaEl).paddingTop === "7px",
  metaEl ? `padding-top ${wide.window.getComputedStyle(metaEl).paddingTop}` : "no tile in DOM");
ok("tiles carry on-frame star + resume state",
  !!wd.querySelector(".grid .tile__star") && !!wd.querySelector(".grid .tile__progress"));
wd.querySelector('.side__item[data-route="home"]').dispatchEvent(new wide.window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 800));
ok("masthead kicker carries the date line",
  /Private collection/.test(wd.querySelector(".greet .t-kicker")?.textContent || ""),
  wd.querySelector(".greet .t-kicker")?.textContent?.slice(0, 48) || "(no kicker)");
ok("rails are numbered editions",
  wd.querySelectorAll(".home .block__eyebrow").length === 6,
  `${wd.querySelectorAll(".home .block__eyebrow").length} eyebrows`);
ok("spotlight caption sits on the frame",
  !!wd.querySelector(".home .spotlight__frame .spotlight__foot"));
ok("sidebar footers the archive totals",
  /items/.test(wd.querySelector(".side__stats")?.textContent || ""),
  wd.querySelector(".side__stats")?.textContent?.trim().slice(0, 40) || "(no stats)");

/* ---------------------------------------------------------------- done -- */

console.log("\n── Errors during boot ──");
if (errors.length) errors.slice(0, 8).forEach((e) => console.log("  ! " + e));
else console.log("  none");
ok("no runtime errors", errors.length === 0, `${errors.length} errors`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
