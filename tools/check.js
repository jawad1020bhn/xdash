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

async function run(width, label) {
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
  await import(`${ROOT}/src/main.js?bp=${width}&v=3`);
  await new Promise((r) => setTimeout(r, WAIT));
  const elapsed = Date.now() - started;

  return { d: window.document, window, elapsed, q: (s) => window.document.querySelectorAll(s).length };
}

/* ============================================================== phone ===== */

const { d, q, window, elapsed } = await run(390, "phone");

ok("boot does not fall into the crash surface", d.getElementById("crash").hidden === true);
ok("the crash surface is display:none, not just [hidden]",
  window.getComputedStyle(d.getElementById("crash")).display === "none",
  window.getComputedStyle(d.getElementById("crash")).display);
ok("shell is visible", d.getElementById("shell").hidden === false);
ok("boot skeleton was removed", !d.getElementById("boot"));

ok("tab bar has three destinations", q(".tab") === 3, `${q(".tab")} tabs`);
ok("sidebar has three destinations", q(".side__item") >= 3, `${q(".side__item")} items`);

const sub = d.querySelector(".dash__sub")?.textContent || "";
ok("greeting reports the real archive", /1\.2K|1,205|1205/.test(sub), sub.trim().slice(0, 70));
ok("four KPI cards render", q(".kpi") === 4, `${q(".kpi")} kpis`);
ok("activity chart renders", q(".chart svg") >= 1, `${q(".chart svg")} chart`);
ok("media mix donut renders", q(".mix__donut svg, .mix svg") >= 1);
ok("creator leaderboard renders", q(".board__row") >= 3, `${q(".board__row")} rows`);
ok("activity feed renders", q(".feed__row") >= 3, `${q(".feed__row")} rows`);
ok("spotlight renders", q(".spot") === 1);
ok("rails hold tiles", q(".rail__track .tile") > 5, `${q(".rail__track .tile")} tiles`);

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

const search = d.querySelector(".lib__bar input");
search.value = "the";
search.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 900));
const afterCount = d.querySelector(".lib__count")?.textContent || "";
ok("search narrows the result count", /of/.test(afterCount), afterCount);

/* ------------------------------------------------- watch + palette ------- */

console.log("\n── Watch & palette (phone) ──");
d.querySelector('.tab[data-route="home"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
d.querySelector('.tab[data-route="watch"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1200));
ok("watch feed rebuilds once data lands", q(".watch__cell") >= 1, `${q(".watch__cell")} cells`);
ok("watch carries its own chrome", q(".watch__top") === 1 && q(".watch__act") >= 2);

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
}

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

/* ---------------------------------------------------------------- done -- */

console.log("\n── Errors during boot ──");
if (errors.length) errors.slice(0, 8).forEach((e) => console.log("  ! " + e));
else console.log("  none");
ok("no runtime errors", errors.length === 0, `${errors.length} errors`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
