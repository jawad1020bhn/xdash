/* =============================================================================
   contextmenu — the iOS long-press menu.

   A blurred scrim, a lifted media preview, and a grouped action list with
   trailing icons — the same verbs as the bottom sheet, in the same order,
   one source of truth (itemActions in ui/actions.js), two presentations.

   The stack anchors near the press point: below it when there is room,
   above it when there is not, clamped to the viewport either way. Only one
   menu exists at a time; opening a second closes the first.
   ============================================================================= */

import { h, icon, reducedMotion } from "../ui/dom.js";
import { anyOverlayOpen } from "../ui/feedback.js";

let current = null;

export function openContextMenu({ x, y, preview, actions, onClose }) {
  closeContextMenu();
  const previouslyFocused = document.activeElement;

  const layer = h("div.ctx");
  const backdrop = h("div.ctx__backdrop");
  const stack = h("div.ctx__stack");

  if (preview?.src) {
    stack.append(h("div.ctx__preview",
      h("img", {
        src: preview.src, alt: "",
        decoding: "async", referrerpolicy: "no-referrer", draggable: "false",
      }),
    ));
  }

  const menu = h("div.ctx__menu", {
    role: "menu", "aria-label": preview?.label || "Item actions",
  });
  for (const a of actions) {
    menu.append(h(`button.ctx__item${a.danger ? ".ctx__item--danger" : ""}`, {
      type: "button", role: "menuitem",
      onclick: () => { close(); a.act(); },
    }, h("span", { text: a.label }), icon(a.icon, 20)));
  }
  stack.append(menu);
  layer.append(backdrop, stack);
  document.body.append(layer);
  document.body.dataset.overlay = "open";

  /* Position after layout, then play the entrance. Until then the stack is
     invisible, so there is no flash at the wrong coordinates. */
  requestAnimationFrame(() => {
    if (closed) return;
    const height = stack.offsetHeight || 320;
    const margin = 12;
    const safeBottom = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--sab")) || 0;
    const maxTop = window.innerHeight - height - margin - safeBottom;
    let top = y + 16;
    if (top > maxTop) top = y - height - 16;
    stack.style.top = `${Math.max(margin, Math.min(top, maxTop))}px`;
    layer.classList.add("is-in");
    menu.querySelector("button")?.focus({ preventScroll: true });
  });

  backdrop.addEventListener("click", close);

  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...menu.querySelectorAll("button")];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") items[Math.min(items.length - 1, at + 1)]?.focus();
    else if (e.key === "ArrowUp") items[Math.max(0, at - 1)]?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else items[items.length - 1]?.focus();
  }
  layer.addEventListener("keydown", onKey);

  /* The page behind a menu is inert: no scroll, no fling, no zoom pan. */
  const swallow = (e) => { e.preventDefault(); };
  layer.addEventListener("touchmove", swallow, { passive: false });
  layer.addEventListener("wheel", swallow, { passive: false });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    current = null;
    layer.classList.remove("is-in");
    layer.classList.add("is-out");
    setTimeout(() => {
      layer.remove();
      if (!anyOverlayOpen()) document.body.dataset.overlay = "";
      onClose?.();
    }, reducedMotion() ? 0 : 170);
    if (previouslyFocused?.focus) {
      try { previouslyFocused.focus({ preventScroll: true }); } catch { /* gone */ }
    }
  }

  current = { close };
  return { close };
}

export function closeContextMenu() {
  current?.close();
}
