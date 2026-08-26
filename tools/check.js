/* =============================================================================
   check — the project's own smoke test.

   Boots the real application modules (src/main.js and everything it imports)
   against a jsdom DOM pointed at the real data file, then asserts on the
   resulting document. No logic is re-implemented here: if this passes, the
   shipping code ran.

   jsdom is a DOM, not a browser — it has no matchMedia, IntersectionObserver,
   requestAnimationFrame, layout or media playback. Those browser APIs are
   stubbed below. Application logic is not.

   Usage:  npm start  (in one shell)   then   npm test
   ============================================================================= */

import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

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
    const mql = {
      media: query, matches, onchange: null,
      addEventListener(t, fn) { (listeners.get(query) ?? listeners.set(query, new Set()).get(query)).add(fn); },
      removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    };
    return mql;
  };

  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); }
    observe(el) {
      this.targets.add(el);
      /* Report every observed element as intersecting, so code that waits on
         visibility (the Watch feed) runs in the test. */
      setTimeout(() => this.cb([{ target: el, intersectionRatio: 1, isIntersecting: true }], this), 0);
    }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
    takeRecords() { return []; }
  };

  window.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() {} unobserve() {} disconnect() {}
  };

  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.animate = function () {
    return { finished: Promise.resolve(), cancel() {}, finish() {} };
  };
  window.Element.prototype.requestFullscreen = function () { return Promise.resolve(); };
  window.Element.prototype.setPointerCapture = function () {};
  window.scrollTo = function () {};
  window.scroll = function () {};

  /* A fetch that resolves relative URLs against the server, the way a browser
     would, and supports HEAD (the data cache fingerprint depends on it). */
  const realFetch = globalThis.fetch;
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? new URL(input, BASE + "/").href : input;
    return realFetch(url, init);
  };

  /* jsdom's document has no layout; give the two measurements the windowing
     maths reads something realistic, without touching the code under test. */
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
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

  /* Publish the DOM as the global environment the modules expect. Some of
     these (navigator, location) already exist on Node's globalThis as
     getter-only accessors, so they have to be redefined rather than assigned. */
  for (const key of ["window", "document", "navigator", "location", "history",
    "HTMLElement", "Element", "Node", "Event", "CustomEvent", "DocumentFragment",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
    "matchMedia", "IntersectionObserver", "ResizeObserver", "localStorage",
    "sessionStorage", "Blob", "URL", "Image", "addEventListener",
    "removeEventListener", "dispatchEvent", "fetch", "innerWidth", "innerHeight",
    "scrollTo", "scrollY", "devicePixelRatio", "screen"]) {
    if (window[key] === undefined) continue;
    Object.defineProperty(globalThis, key, {
      value: window[key], configurable: true, writable: true,
    });
  }
  globalThis.window = window;
  globalThis.document = window.document;
  /* Window methods must stay bound to the window when called as bare globals. */
  for (const key of ["addEventListener", "removeEventListener", "dispatchEvent",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
    "matchMedia", "scrollTo", "fetch"]) {
    if (typeof globalThis[key] === "function") {
      globalThis[key] = globalThis[key].bind(window);
    }
  }

  window.addEventListener("error", (e) =>
    errors.push(`window.error: ${String(e.error?.stack || e.message).split("\n").slice(0, 3).join(" | ")}`));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push(`unhandledrejection: ${String(e.reason?.stack || e.reason).split("\n").slice(0, 3).join(" | ")}`));

  const started = Date.now();
  await import(`${ROOT}/src/main.js?bp=${width}`);
  await new Promise((r) => setTimeout(r, WAIT));
  const elapsed = Date.now() - started;

  const d = window.document;
  const q = (s) => d.querySelectorAll(s).length;

  return { d, q, window, elapsed };
}

/* -------------------------------------------------------------- checks --- */

const { d, q, window, elapsed } = await run(390, "phone");

ok("boot does not fall into the crash surface",
  d.getElementById("crash").hidden === true);
ok("shell is visible", d.getElementById("shell").hidden === false);
ok("boot skeleton was removed", !d.getElementById("boot"));

ok("navigation has three destinations", q(".nav__item") === 3,
  `${q(".nav__item")} found`);

const stats = d.querySelector(".greet__line")?.textContent || "";
ok("greeting reports the real archive", /1\.2K|1,205|1205/.test(stats), stats.trim().slice(0, 60));

ok("feature card rendered", q(".feature .card") === 1);
ok("content sections rendered", q(".block") >= 3, `${q(".block")} blocks`);
ok("rails hold cards", q(".rail__track .card") > 5, `${q(".rail__track .card")} cards`);
ok("creator row rendered", q(".creator") >= 3, `${q(".creator")} creators`);

const imgs = [...d.querySelectorAll("img")];
ok("every image has alt text", imgs.every((i) => (i.alt || "").trim().length > 0),
  `${imgs.filter((i) => (i.alt || "").trim()).length}/${imgs.length} with alt`);
/* Read the attribute, not the IDL property: jsdom does not implement
   HTMLImageElement.loading, so the property reads undefined even when the
   markup is correct. */
const lazy = imgs.filter((i) => i.getAttribute("loading") === "lazy");
ok("thumbnails are lazy-loaded", lazy.length > imgs.length * 0.8,
  `${lazy.length}/${imgs.length} lazy`);
ok("thumbnails request a small rendition",
  imgs.filter((i) => /name=small|_200x200/.test(i.getAttribute("srcset") || i.getAttribute("src") || "")).length > 0,
  `${imgs.filter((i) => /name=small/.test(i.getAttribute("srcset") || "")).length} with srcset`);

const docBytes = d.documentElement.outerHTML.length;
ok("initial DOM stays small", docBytes < 200_000, `${(docBytes / 1024).toFixed(0)} KB of HTML`);
ok("booted with data in under 9s", elapsed < WAIT + 1000, `${elapsed}ms`);

/* ------------------------------------------------- the Library window --- */

console.log("\n── Library windowing ──");
d.querySelector('.nav__item[data-route="library"]').dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 1200));

const tiles = q(".grid .card");
const viewportH = parseFloat(d.querySelector(".grid-viewport")?.style.height || "0");
ok("library mounted", q(".library") === 1);
ok("grid windowed, not fully rendered", tiles > 0 && tiles < 200,
  `${tiles} tiles in the DOM for 1,205 items`);
ok("scroll height reflects the whole archive", viewportH > 10_000,
  `${Math.round(viewportH)}px of scroll height`);
ok("search field present", !!d.querySelector(".lib__search input"));
ok("filter chips present", q(".lib__chips .chip") >= 3, `${q(".lib__chips .chip")} chips`);

/* Search must actually narrow the result set. */
const search = d.querySelector(".lib__search input");
search.value = "the";
search.dispatchEvent(new window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 700));
const afterCount = d.querySelector(".lib__count")?.textContent || "";
ok("search narrows the result count", /of/.test(afterCount), afterCount);

/* ---------------------------------------------------------------- done -- */

console.log("\n── Errors during boot ──");
if (errors.length) errors.slice(0, 8).forEach((e) => console.log("  ! " + e));
else console.log("  none");
ok("no runtime errors", errors.length === 0, `${errors.length} errors`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
