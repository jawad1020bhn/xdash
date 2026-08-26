/* =============================================================================
   feedback — toasts, sheets, confirms.

   One overlay primitive, used everywhere. On a phone it is a bottom sheet with
   a real drag-to-dismiss; from 720px up the same primitive becomes a centred
   dialog. Focus is trapped, Escape closes, and focus returns to whatever
   opened it. That is the whole contract, and it is the same for every sheet in
   the product.
   ============================================================================= */

import { h, icon, clear, reducedMotion, haptic, useBreakpoint, nextFrame } from "./dom.js";

/* ---------------------------------------------------------------- toasts -- */

const TOAST_MS = 3600;

export function toast(message, { action, onAction, duration = TOAST_MS } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;

  const el = h(".toast", { role: "status" },
    h("span.toast__msg", { text: message }),
    action ? h("button.toast__action", {
      type: "button", text: action,
      onclick: () => { onAction?.(); dismiss(); },
    }) : null,
  );
  host.append(el);
  nextFrame().then(() => el.classList.add("is-in"));

  let timer = setTimeout(dismiss, duration);
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => { timer = setTimeout(dismiss, 1200); });

  function dismiss() {
    clearTimeout(timer);
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), reducedMotion() ? 0 : 200);
  }
  return dismiss;
}

/* ----------------------------------------------------------------- modal -- */

const openOverlays = [];

/**
 * Opens a modal surface. Returns { el, content, close }.
 *
 * `kind`:
 *   "sheet"  bottom sheet on compact, centred dialog on wide
 *   "full"   always full-height (used by the viewer)
 */
export function overlay({ title, kind = "sheet", onClose, size = "md", closeLabel = "Close" } = {}) {
  const previouslyFocused = document.activeElement;
  const scrim = h(".scrim");
  const panel = h(`.sheet.sheet--${size}`, {
    role: "dialog", "aria-modal": "true", tabindex: "-1",
    "aria-label": title || "Dialog",
  });

  let dragHandle = null;
  if (kind !== "full" && useBreakpoint().compact) {
    dragHandle = h("button.sheet__handle", {
      type: "button", "aria-label": closeLabel,
      onclick: () => close(),
    }, h("span"));
  }

  const header = title ? h(".sheet__header",
    h("h2.sheet__title.t-h2", { text: title }),
    h("button.icon-btn", { type: "button", "aria-label": closeLabel, onclick: () => close() },
      icon("close", 20)),
  ) : null;

  const content = h(".sheet__body");
  panel.append(dragHandle, header, content);

  document.body.append(scrim, panel);
  document.documentElement.style.setProperty("--sheet-open", "1");
  lockScroll();

  /* ---- open transition ---- */
  nextFrame().then(() => {
    scrim.classList.add("is-in");
    panel.classList.add("is-in");
  });

  /* ---- drag to dismiss (touch only, sheet only) ---- */
  let dragStartY = 0;
  let dragging = false;
  if (dragHandle) {
    dragHandle.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragStartY = e.clientY;
      panel.classList.add("is-dragging");
      dragHandle.setPointerCapture(e.pointerId);
    });
    dragHandle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - dragStartY);
      panel.style.translate = `0 ${dy}px`;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("is-dragging");
      panel.style.translate = "";
      const dy = e.clientY - dragStartY;
      if (dy > 80) close();
      else haptic(4);
    };
    dragHandle.addEventListener("pointerup", end);
    dragHandle.addEventListener("pointercancel", end);
  }

  /* ---- focus management ---- */
  const focusables = () => [...panel.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null || el === document.activeElement);

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener("keydown", onKeydown, true);

  scrim.addEventListener("click", close);
  requestAnimationFrame(() => panel.focus({ preventScroll: true }));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    scrim.classList.remove("is-in");
    panel.classList.remove("is-in");
    unlockScroll();
    document.documentElement.style.removeProperty("--sheet-open");
    setTimeout(() => {
      scrim.remove();
      panel.remove();
      const i = openOverlays.indexOf(handle);
      if (i >= 0) openOverlays.splice(i, 1);
      if (!openOverlays.length) document.body.dataset.overlay = "";
      onClose?.();
      previouslyFocused?.focus?.({ preventScroll: true });
    }, reducedMotion() ? 0 : 220);
  }

  const handle = { el: panel, content, close, scrim };
  openOverlays.push(handle);
  document.body.dataset.overlay = "open";
  return handle;
}

export function anyOverlayOpen() {
  return openOverlays.length > 0;
}

let scrollLocks = 0;
let savedScroll = 0;
function lockScroll() {
  if (scrollLocks++ === 0) {
    savedScroll = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScroll}px`;
    document.body.style.insetInline = "0";
    document.body.style.overflow = "hidden";
  }
}
function unlockScroll() {
  if (--scrollLocks > 0) return;
  scrollLocks = 0;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.insetInline = "";
  document.body.style.overflow = "";
  window.scrollTo(0, savedScroll);
}

/* --------------------------------------------------------------- confirm -- */

export function confirm({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const { content, close } = overlay({
      title, size: "sm",
      onClose: () => done(false),
    });

    content.append(
      h("p.sheet__text", { text: message }),
      h(".sheet__actions",
        h("button.btn", {
          type: "button", text: cancelLabel,
          onclick: () => { done(false); close(); },
        }),
        h(`button.btn.${danger ? "btn--danger" : "btn--primary"}`, {
          type: "button", text: confirmLabel,
          onclick: () => { done(true); close(); },
        }),
      ),
    );
  });
}

/** Clears a container and shows a small inline notice instead. */
export function emptyState(host, { title, message, icon: iconName = "info", action } = {}) {
  clear(host);
  host.append(h(".empty",
    h("span.empty__icon", icon(iconName, 22)),
    h("h3.empty__title", { text: title }),
    message ? h("p.empty__msg", { text: message }) : null,
    action ? h("button.btn.btn--primary", { type: "button", text: action.label, onclick: action.onClick }) : null,
  ));
}
