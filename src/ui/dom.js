/* =============================================================================
   dom — the tiny DOM toolkit every view shares.

   h() builds elements from a CSS-ish selector; breakpoints are the SAME two
   numbers CSS uses (720 / 1080) so layout logic and stylesheets cannot drift.
   ========================================================================== */

export const BP = { mid: 720, wide: 1080 };

/* Views import h and icon together; keep that ergonomic. */
export { icon } from "./icons.js";

/**
 * h("button.card.is-on", { onclick, dataset, text }, ...children)
 * Children may be nodes, strings, arrays, or null.
 */
export function h(sel, attrs, ...children) {
  const [tag, ...classes] = sel.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");

  if (attrs && !(attrs instanceof Node) && !Array.isArray(attrs) && typeof attrs !== "string") {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "text") el.textContent = value;
      else if (key === "html") el.innerHTML = value;
      else if (key === "class") {
        const parts = String(value).split(/\s+/).filter(Boolean);
        if (parts.length) el.classList.add(...parts);
      }
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style" && typeof value === "object") {
        for (const [p, v] of Object.entries(value)) {
          if (v === null || v === undefined) continue;
          p.startsWith("--") ? el.style.setProperty(p, v) : (el.style[p] = v);
        }
      }
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  } else if (attrs !== undefined) {
    children.unshift(attrs);
  }

  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(String(child));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/* ------------------------------------------------------------ breakpoints -- */

let bpListeners = [];
let currentBP = readBP();

function readBP() {
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  return w >= BP.wide ? "wide" : w >= BP.mid ? "mid" : "compact";
}

export function initBreakpoints() {
  currentBP = readBP();
  document.documentElement.dataset.bp = currentBP;
  addEventListener("resize", () => {
    const next = readBP();
    if (next === currentBP) return;
    currentBP = next;
    document.documentElement.dataset.bp = next;
    for (const fn of bpListeners) fn(next);
  }, { passive: true });
}

export const breakpoint = () => currentBP;
export const isCompact = () => currentBP === "compact";
export function onBreakpoint(fn) {
  bpListeners.push(fn);
  return () => { bpListeners = bpListeners.filter((f) => f !== fn); };
}

/* ----------------------------------------------------------------- misc -- */

export const isTouch = () =>
  matchMedia?.("(hover: none), (pointer: coarse)")?.matches ?? false;

export const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" ||
  matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

export function haptic(ms = 8) {
  if (!isTouch()) return;
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

/** Animated number roll for KPI cards. Respects reduced motion. */
export function countUp(el, target, { duration = 700, format = (n) => String(n) } = {}) {
  if (reducedMotion()) { el.textContent = format(target); return; }
  const started = performance.now();
  const from = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Runs fn on the next idle moment, batched — used by the windowed grid. */
export function onIdle(fn, timeout = 120) {
  if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 16);
}

/** Escape-to-close, stacked so the topmost overlay wins. */
const escStack = [];
export function pushEsc(fn) {
  escStack.push(fn);
  if (escStack.length === 1) addEventListener("keydown", escHandler);
  return () => {
    const i = escStack.indexOf(fn);
    if (i >= 0) escStack.splice(i, 1);
    if (!escStack.length) removeEventListener("keydown", escHandler);
  };
}
function escHandler(e) {
  if (e.key === "Escape") { e.stopPropagation(); escStack[escStack.length - 1]?.(); }
}

/** Keeps Tab inside an overlay while it is open. */
export function trapFocus(container, initial) {
  const selector = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const onKey = (e) => {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(selector)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener("keydown", onKey);
  initial?.focus({ preventScroll: true });
  return () => container.removeEventListener("keydown", onKey);
}
