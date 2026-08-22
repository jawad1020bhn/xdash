/* =============================================================================
   XBPWA — service-worker lifecycle, installability and connectivity feedback

   Deliberately small in surface, careful in behaviour:

     · registers the worker only on secure origins (file:// can't have one)
     · asks for persistent storage so the archive's caches survive pressure
     · detects a waiting worker and surfaces "Update available" through the
       app's own snackbar; reload applies it on the user's terms
     · tells the user when the connection drops and returns
   ============================================================================= */
(function (root) {
  "use strict";

  let firstController = true;

  function toast(message, opts) {
    if (root.XBApp && root.XBApp.toast) root.XBApp.toast(message, opts);
  }

  /* --------------------------------------------------------- registration -- */
  async function register() {
    if (!("serviceWorker" in navigator)) return;
    if (!root.isSecureContext) return; // file:// and plain http: simply skip

    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

      /* A worker is installed and waiting while an old one still controls the
         page → an update is ready. Offer it; never auto-reload mid-session. */
      const announce = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          toast("A new version of the archive is ready", {
            action: "Reload",
            duration: 0,
            onAction: () => {
              reg.waiting.postMessage({ type: "SKIP_WAITING" });
            },
          });
        }
      };
      if (reg.waiting) announce();
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" &&
              navigator.serviceWorker.controller) announce();
        });
      });

      /* When the new worker takes control we are one reload away from it.
         The very first claim after a cold start is not an update. */
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (firstController) { firstController = false; return; }
        root.location.reload();
      });

      /* Ask the worker which version is live (useful in console debugging). */
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "GET_VERSION" });
      }
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "VERSION") {
          root.XB_PWA_VERSION = event.data.version;
        }
      });

      /* Check for updates at most hourly, only when the page is visible. */
      setInterval(() => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      }, 60 * 60 * 1000);
    } catch (_) {
      /* Registration failure must never break the app itself. */
    }
  }

  /* ------------------------------------------------------------ storage -- */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist &&
          navigator.storage.persisted && !await navigator.storage.persisted()) {
        await navigator.storage.persist();
      }
    } catch (_) { /* best-effort */ }
  }

  /* -------------------------------------------------------- connectivity -- */
  function bindConnectivity() {
    const offline = () => toast("You're offline — your cached library is still available", { error: true });
    const online = () => toast("Back online");
    root.addEventListener("offline", offline);
    root.addEventListener("online", online);
    if (!root.navigator.onLine) offline();
  }

  function boot() {
    register();
    requestPersistence();
    bindConnectivity();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
