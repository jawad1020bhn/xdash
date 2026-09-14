/* =============================================================================
   main v3 — boot.

   The order and the guarantee are the product: the shell appears immediately,
   data arrives behind it, and nothing in this file is allowed to leave the
   user on a blank screen. v1 called boot() with no catch at all; every step
   here is inside a try, and the catch renders a real message with the stack.
   ========================================================================== */

import { h, icon, initBreakpoints } from "./ui/dom.js";
import { loadPersisted, state, set, applyPrefs } from "./core/state.js";
import { loadIndex } from "./core/data.js";
import { initShell, navigate, readHash } from "./shell.js";
import { toast } from "./ui/feedback.js";

boot();

async function boot() {
  try {
    initBreakpoints();
    await loadPersisted();
    applyPrefs();

    if (state.prefs.pin) {
      const unlocked = await unlock(state.prefs.pin);
      if (!unlocked) return;
    }

    initShell({
      home: await import("./views/home.js"),
      library: await import("./views/library.js"),
      watch: await import("./views/watch.js"),
    });

    navigate(readHash() || state.prefs.landing || "home", { replace: true });

    loadArchive();
    registerServiceWorker();
    wireOnlineState();
  } catch (err) {
    crash(err);
  }
}

async function loadArchive() {
  try {
    const started = performance.now();
    const result = await loadIndex((msg) => setLoadMessage(msg));

    set({
      index: { posts: result.posts, media: result.media, authors: result.authors },
      source: result.source,
      ready: true,
    });
    clearLoadMessage();

    const ms = Math.round(performance.now() - started);
    if (result.source === "none") {
      toast("No archive found. Import one to get started.", {
        action: "Import",
        onAction: () => import("./views/manage.js").then((m) => m.openManage()),
        duration: 9000,
      });
    } else if (!result.fromCache) {
      console.info(`[archive] indexed ${result.media.length} items in ${ms}ms from ${result.source}`);
    }
  } catch (err) {
    console.error("[archive] load failed", err);
    clearLoadMessage();
    toast("Your archive could not be loaded.", {
      action: "Details", onAction: () => crash(err), duration: 10000,
    });
  }
}

/* ------------------------------------------------------------------- lock -- */

/** Opt-in, user-chosen, and honest about what a PIN in a browser can do. */
function unlock(pin) {
  return new Promise((resolve) => {
    const error = h("p", { role: "alert", "aria-live": "assertive", style: { color: "var(--danger)", fontSize: "var(--fs-small)", minHeight: "18px", margin: "6px 0 0" } });
    const input = h("input", {
      type: "password", inputmode: "numeric", autocomplete: "off",
      placeholder: "PIN", "aria-label": "PIN", maxlength: "12",
    });
    const card = h("form.lock__card",
      h("span.mark", { style: { width: "44px", height: "44px", borderRadius: "14px", margin: "0 auto" } }, icon("bookmark", 22)),
      h("h1.t-h1", { text: "Locked", style: { textAlign: "center", marginTop: "14px" } }),
      h("p.t-small", { text: "Enter your PIN to open this archive.", style: { textAlign: "center", color: "var(--text-2)", marginTop: "6px" } }),
      h("div.field", { style: { marginTop: "18px" } }, icon("lock", 17), input),
      error,
      h("button.btn.btn--pri.btn--block", { type: "submit", text: "Unlock", style: { marginTop: "14px" } }),
    );
    const wrap = h("div.lock", { role: "dialog", "aria-modal": "true", "aria-label": "Enter your PIN" }, card);

    card.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value === pin) {
        wrap.classList.add("is-out");
        setTimeout(() => { wrap.remove(); resolve(true); }, 180);
      } else {
        error.textContent = "That is not the PIN.";
        input.select();
        card.animate?.(
          [{ translate: "0 0" }, { translate: "-7px 0" }, { translate: "7px 0" }, { translate: "-4px 0" }, { translate: "0 0" }],
          { duration: 320, easing: "cubic-bezier(0.36,0.07,0.19,0.97)" },
        );
      }
    });

    document.getElementById("boot")?.remove();
    document.body.append(wrap);
    requestAnimationFrame(() => { wrap.classList.add("is-in"); input.focus({ preventScroll: true }); });
  });
}

/* -------------------------------------------------------------- messaging -- */

let msgEl = null;
function setLoadMessage(text) {
  if (!msgEl) {
    msgEl = h("div.loadmsg", { role: "status", "aria-live": "polite" }, h("span.spinner"), h("span", { text }));
    document.body.append(msgEl);
  } else {
    msgEl.lastElementChild.textContent = text;
  }
  requestAnimationFrame(() => msgEl?.classList.add("is-in"));
}

function clearLoadMessage() {
  if (!msgEl) return;
  const el = msgEl;
  msgEl = null;
  el.classList.remove("is-in");
  setTimeout(() => el.remove(), 240);
}

/* ------------------------------------------------------------------ crash -- */

function crash(err) {
  console.error("[boot]", err);
  const box = document.getElementById("crash");
  const shell = document.getElementById("shell");
  if (shell) shell.hidden = true;
  document.getElementById("boot")?.remove();
  clearLoadMessage();
  if (!box) return;
  box.hidden = false;
  document.getElementById("crashMsg").textContent = String(err?.message || err);
  const stack = document.getElementById("crashStack");
  stack.hidden = false;
  stack.textContent = String(err?.stack || err);

  document.getElementById("crashRetry").onclick = () => location.reload();
  document.getElementById("crashReset").onclick = async () => {
    const { removeMany, KEYS } = await import("./core/store.js");
    await removeMany(Object.values(KEYS));
    location.reload();
  };
}

addEventListener("error", (e) => {
  if (document.getElementById("shell")?.hidden === false) return;
  crash(e.error || new Error(e.message));
});
addEventListener("unhandledrejection", (e) => console.error("[unhandled]", e.reason));

/* ---------------------------------------------------------------- offline -- */

function wireOnlineState() {
  const paint = () => { document.body.dataset.online = navigator.onLine ? "true" : "false"; };
  addEventListener("online", () => { paint(); toast("Back online"); });
  addEventListener("offline", () => { paint(); toast("Offline — showing what is cached here"); });
  paint();
}

/* -------------------------------------------------------------- sw + pwa -- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) return;

  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              toast("A new version is ready", { action: "Reload", onAction: () => worker.postMessage("SKIP_WAITING"), duration: 12000 });
            }
          });
        });
      })
      .catch((err) => console.info("[sw] not registered:", err.message));
  });
}
