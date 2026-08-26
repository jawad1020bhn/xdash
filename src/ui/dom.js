/* =============================================================================
   dom — the one way this app touches the DOM.

   h("button.card", { onclick }, ...children) returns a real element. No innerHTML
   interpolation of user data anywhere, so the tweet text and creator names that
   flow through this app can never become markup.

   Icons are defined in icons.js and re-exported here, because every view needs
   both and should not have to know which file each one lives in.
   ============================================================================= */

export { icon, ICON_NAMES } from "./icons.js";

/** Split "button.card.tile--active#id" into tag, classes and id. */
function parseSpec(spec) {
  const parts = spec.split(/(?=[.#])/);
  const tag = /^[a-z]/i.test(parts[0]) ? parts.shift() : "div";
  const classes = [];
  let id = null;
  for (const part of parts) {
    const value = part.slice(1);
    if (!value) continue;
    if (part[0] === "#") id = value;
    else if (part[0] === ".") classes.push(value);
  }
  return { tag, classes, id };
}

function setProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className += (el.className ? " " : "") + value;
    else if (key === "style") Object.assign(el.style, value);
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;   // only for trusted local icon strings
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
}

export function h(spec, props, ...children) {
  const { tag, classes, id } = parseSpec(spec);
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(" ");
  if (id) el.id = id;
  if (props && (typeof props !== "object" || props.nodeType || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) setProps(el, props);
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  if (!el) return el;
  el.replaceChildren();
  return el;
}

/** Build a DocumentFragment from children — cheaper than N appends. */
export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function attr(el, name, value) {
  if (value === null || value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, value);
  return el;
}

/* ---------------------------------------------------------------- motion -- */

/** Runs a transition only when the user has not asked for reduced motion. */
export function reducedMotion() {
  return document.documentElement.dataset.motion === "reduced" ||
    (matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** Short tick on touch devices; a no-op everywhere else. */
export function haptic(pattern = 8) {
  if (matchMedia?.("(hover: none)").matches && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* some platforms reject */ }
  }
}

/**
 * One shared breakpoint source. CSS uses min-width 720 / 1080; JS asks the
 * same two numbers. The previous codebase had eight breakpoints in CSS and a
 * seventh, different one in JS, which is how the two drifted apart.
 */
const listeners = new Set();
let cached = { compact: true, tablet: false, desktop: false };

function readBreakpoint() {
  const w = window.innerWidth;
  cached = { compact: w < 720, tablet: w >= 720 && w < 1080, desktop: w >= 1080 };
  document.documentElement.dataset.bp =
    cached.desktop ? "desktop" : cached.tablet ? "tablet" : "compact";
  for (const fn of listeners) fn(cached);
  return cached;
}

export function useBreakpoint() {
  readBreakpoint();
  return cached;
}

export function onBreakpoint(fn) {
  listeners.add(fn);
  fn(cached);
  return () => listeners.delete(fn);
}

let boundResize = false;
export function initBreakpoints() {
  if (boundResize) return;
  boundResize = true;
  readBreakpoint();
  let frame = 0;
  addEventListener("resize", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; readBreakpoint(); });
  }, { passive: true });
}

/** True for touch-primary devices. Drives hover-vs-tap affordances. */
export function isTouch() {
  return matchMedia?.("(hover: none), (pointer: coarse)").matches ?? false;
}

/** Wait for the next paint. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
