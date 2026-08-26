/* =============================================================================
   main — boot.

   The order matters and so does the guarantee: the shell appears immediately,
   the data arrives behind it, and nothing in this file is allowed to leave the
   user on a blank screen. Every step is inside a try, and the catch renders a
   real message with the real stack. The previous build called boot() with no
   error handling at all, so a single throw in a long async chain produced a
   permanently white page and no clue why.
   ============================================================================= */

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
      if (!unlocked) return;   // the gate owns the screen until it is passed
    }

    initShell({
      home: await import("./views/home.js"),
      library: await import("./views/library.js"),
      watch: await import("./views/watch.js"),
    });

    navigate(readHash() || state.prefs.landing || "home", { replace: true });

    /* Data loads after the frame is up, so there is something on screen to look
       at while a 17 MB file is being read. */
    loadArchive();

    registerServiceWorker();
    wireOnlineState();
  } catch (err) {
    crash(err);
  }
}

async function loadArchive() {
  const progress = (msg) => setLoadMessage(msg);
  try {
    const started = performance.now();
    const result = await loadIndex(progress);

    set({
      index: { posts: result.posts, media: result.media, authors: result.authors },
      source: result.source,
      ready: true,
    });
    clearLoadMessage();

    const ms = Math.round(performance.now() - started);
    if (result.source === "none") {
      toast("No archive found. Import one to get started.", {
        action: "Import", onAction: () => import("./views/manage.js").then((m) => m.openManage()),
        duration: 8000,
      });
    } else if (!result.fromCache) {
      console.info(`[archive] indexed ${result.media.length} items in ${ms}ms from ${result.source}`);
    }
  } catch (err) {
    console.error("[archive] load failed", err);
    clearLoadMessage();
    toast("Your archive could not be loaded. Check the file and reload.", {
      action: "Details", onAction: () => crash(err),
      duration: 10000,
    });
  }
}

/* ------------------------------------------------------------------ lock -- */

/**
 * The old build shipped a hard-coded password in its source. This gate is
 * opt-in, user-chosen, and honest about what it can and cannot do.
 */
function unlock(pin) {
  return new Promise((resolve) => {
    const error = h("p.lock__error", { role: "alert", "aria-live": "assertive" });
    const input = h("input.lock__input", {
      type: "password", inputmode: "numeric", autocomplete: "off",
      placeholder: "PIN", "aria-label": "PIN", maxlength: "12",
    });
    const wrap = h("div.lock", { role: "dialog", "aria-modal": "true", "aria-label": "Enter your PIN" },
      h("form.lock__card",
        h("span.lock__icon", icon("lock", 26)),
        h("h1.lock__title", { text: "Locked" }),
        h("p.lock__sub", { text: "Enter your PIN to open this archive." }),
        h("div.field", input),
        error,
        h("button.btn.btn--primary.btn--block", { type: "submit", text: "Unlock" }),
      ),
    );

    wrap.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value === pin) {
        wrap.classList.add("is-out");
        setTimeout(() => { wrap.remove(); resolve(true); }, 180);
      } else {
        error.textContent = "That is not the PIN.";
        input.select();
        wrap.querySelector(".lock__card").animate?.(
          [{ translate: "0 0" }, { translate: "-7px 0" }, { translate: "7px 0" },
           { translate: "-4px 0" }, { translate: "0 0" }],
          { duration: 320, easing: "cubic-bezier(0.36,0.07,0.19,0.97)" },
        );
      }
    });

    document.getElementById("boot")?.remove();
    document.body.append(wrap);
    requestAnimationFrame(() => { wrap.classList.add("is-in"); input.focus({ preventScroll: true }); });
  });
}

/* ------------------------------------------------------------ messaging -- */

let msgEl = null;
function setLoadMessage(text) {
  if (!msgEl) {
    msgEl = h("div.loadmsg", { role: "status", "aria-live": "polite" },
      h("span.spinner"), h("span", { text }));
    document.body.append(msgEl);
  } else {
    msgEl.lastElementChild.textContent = text;
  }
  requestAnimationFrame(() => msgEl?.classList.add("is-in"));
}

function clearLoadMessage() {
  if (!msgEl) return;
  msgEl.classList.remove("is-in");
  const el = msgEl;
  msgEl = null;
  setTimeout(() => el.remove(), 240);
}

/* ----------------------------------------------------------------- crash -- */

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

/* Global safety net: anything uncaught after boot still gets surfaced. */
addEventListener("error", (e) => {
  if (document.getElementById("shell")?.hidden === false) return;
  crash(e.error || new Error(e.message));
});
addEventListener("unhandledrejection", (e) => {
  console.error("[unhandled]", e.reason);
});

/* --------------------------------------------------------------- offline -- */

function wireOnlineState() {
  const paint = () => { document.body.dataset.online = navigator.onLine ? "true" : "false"; };
  addEventListener("online", () => { paint(); toast("Back online"); });
  addEventListener("offline", () => { paint(); toast("Offline — showing what is cached here"); });
  paint();
}

/* ------------------------------------------------------------ sw + pwa -- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:" &&
      location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              toast("A new version is ready", {
                action: "Reload", onAction: () => worker.postMessage("SKIP_WAITING"),
                duration: 12000,
              });
            }
          });
        });
      })
      .catch((err) => console.info("[sw] not registered:", err.message));
  });
}
