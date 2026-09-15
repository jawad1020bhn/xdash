/* =============================================================================
   feedback v3 — overlays, sheets, toasts, confirms, empty states.

   One overlay primitive; everything modal is built on it, so Escape, focus
   trapping, scroll locking and the frosted scrim behave identically
   everywhere.
   ========================================================================== */

import { h, icon, pushEsc, trapFocus, clear } from "./dom.js";

let overlayCount = 0;

/**
 * overlay({ title, size, onClose }) → { root, sheet, content, close }
 * The scrim fades, the sheet springs up from the bottom on phones and sits
 * centred from 720px up.
 */
export function overlay({ title = "", size = "", onClose } = {}) {
  const content = h("div.sheet__body");
  const head = h("div.sheet__head",
    h("span.sheet__title", { text: title }),
    h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => api.close() }, icon("close", 20)),
  );
  const sheet = h("div.sheet" + (size ? ` sheet--${size}` : ""), { role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" }, head, content);
  const root = h("div.overlay", sheet);
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let released = null;
  const api = {
    root, sheet, content,
    close(result) {
      if (root.dataset.closing) return;
      root.dataset.closing = "1";
      root.classList.remove("is-in");
      sheet.style.translate = "0 24px";
      setTimeout(() => {
        root.remove();
        overlayCount--;
        if (!overlayCount) document.body.style.overflow = "";
        released?.();
        releaseEsc?.();
        try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* opener gone */ }
        onClose?.(result);
      }, 180);
    },
  };

  root.addEventListener("pointerdown", (e) => { if (e.target === root) api.close(); });

  document.body.append(root);
  overlayCount++;
  document.body.style.overflow = "hidden";
  const releaseEsc = pushEsc(() => api.close());
  released = trapFocus(sheet, head.querySelector("button"));
  requestAnimationFrame(() => root.classList.add("is-in"));
  return api;
}

/* ---------------------------------------------------------------- toasts -- */

export function toast(message, { action, onAction, duration = 4200 } = {}) {
  const host = document.getElementById("toasts") || (() => {
    const t = h("div.toasts", { id: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(t);
    return t;
  })();

  const el = h("div.toast",
    h("span.toast__msg", { text: message }),
    action ? h("button.toast__act", {
      type: "button", text: action,
      onclick: () => { dismiss(); onAction?.(); },
    }) : null,
  );
  host.append(el);
  requestAnimationFrame(() => el.classList.add("is-in"));

  let timer = setTimeout(dismiss, duration);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 220);
  }
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => { timer = setTimeout(dismiss, 1600); });
  return dismiss;
}

/* --------------------------------------------------------------- confirm -- */

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const sheet = overlay({ title, size: "sm", onClose: (r) => resolve(!!r) });
    sheet.content.append(
      h("p.t-small", { style: { color: "var(--text-2)", padding: "4px 4px 0" }, text: message }),
      h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "20px" } },
        h("button.btn", { type: "button", text: "Cancel", onclick: () => sheet.close(false) }),
        h(`button.btn ${danger ? "btn--danger" : "btn--pri"}`, {
          type: "button", text: confirmLabel, onclick: () => sheet.close(true),
        }),
      ),
    );
  });
}

/* ---------------------------------------------------------- empty state -- */

export function emptyState(host, { icon: name = "database", title, message, action } = {}) {
  clear(host);
  host.append(h("div.empty",
    h("div.empty__icon", icon(name, 28)),
    h("h2", { text: title }),
    message ? h("p", { text: message }) : null,
    action ? h("button.btn.btn--pri", { type: "button", onclick: action.onClick }, action.label) : null,
  ));
}

/* ------------------------------------------------------------- prompt ----- */

export function promptDialog({ title, label, placeholder = "", initial = "" } = {}) {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", placeholder, value: initial, "aria-label": label });
    const sheet = overlay({ title, size: "sm", onClose: (r) => resolve(r ?? null) });
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); sheet.close(input.value.trim() || null); } },
      h("div.field", input),
      h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" } },
        h("button.btn", { type: "button", text: "Cancel", onclick: () => sheet.close(null) }),
        h("button.btn.btn--pri", { type: "submit", text: "Save" }),
      ),
    );
    sheet.content.append(form);
    setTimeout(() => input.focus(), 60);
  });
}

/* ---------------------------------------------------------- loading ------- */

/**
 * First-paint skeletons, shaped like the surface they stand in for. Used
 * while the archive is still indexing (`!state.ready`) so no view ever
 * flashes its empty state on a slow first load. Class names deliberately
 * avoid `.grid`/`.rail`/`.chart`: skeletons must never satisfy content
 * assertions.
 */
export function loadingState(host, kind = "home") {
  clear(host);
  const tile = () => h("div.sk.sk--tile");
  if (kind === "library") {
    host.append(h("div.skel-grid", { "aria-label": "Loading your archive" },
      Array.from({ length: 12 }, tile)));
    return;
  }
  if (kind === "watch") {
    host.append(h("div.skel-watch", h("span.spinner", { "aria-label": "Loading your feed" })));
    return;
  }
  host.append(h("div.skel-home",
    h("div.boot__mast", h("div.sk.sk--kicker"), h("div.sk.sk--mast"), h("div.sk.sk--sub")),
    h("div.boot__rails",
      h("div.boot__rail", h("div.sk.sk--label"),
        h("div.boot__strip", Array.from({ length: 6 }, tile))),
      h("div.boot__rail", h("div.sk.sk--label"),
        h("div.boot__strip", Array.from({ length: 6 }, tile))))));
}
