/* =============================================================================
   XBApp · Lock — a fixed-password gate for a client-side-only dashboard.

   This is a static site with no server, so the gate is enforced in the browser:
   the app's boot() is suspended until the correct password is entered, and the
   archive is never rendered while locked. It is a hard gate — the password is
   fixed and cannot be created, changed or removed.

   SECURITY NOTE: because every byte of this app ships to the browser, a
   determined attacker can read the code and see the password, or strip this
   file out entirely and serve the dashboard themselves. A client-side password
   therefore stops casual access (a shared computer, a phone left unlocked,
   shoulder-surfing) — it is not a substitute for real server authentication.
   Treat it as a privacy curtain, not a vault.
   ============================================================================= */
(function (root) {
  "use strict";

  const PASSWORD = "2055";
  const SESSION_KEY = "xLockSession"; // sessionStorage flag: unlocked this tab session

  let pendingBoot = null;
  let lockEl = null;

  function isUnlocked() {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch (_) { return false; }
  }
  function markUnlocked() {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}
  }

  /* ------------------------------------------------------- the boot gate */

  function installBootGate(app) {
    const realBoot = app.boot;
    if (!realBoot || realBoot.__gated) return;
    app.boot = function gatedBoot() {
      const args = arguments; // captured before any await (arrows have no `arguments`)
      pendingBoot = () => realBoot.apply(null, args);
      if (isUnlocked()) { release(); return; }
      showLockScreen();
    };
    app.boot.__gated = true;
  }

  /* ----------------------------------------------------------- lock screen */

  function removeOverlay() {
    if (lockEl) { lockEl.remove(); lockEl = null; }
  }

  function showLockScreen() {
    if (!root.XBUI) { setTimeout(showLockScreen, 30); return; }
    const { h, icon } = root.XBUI;
    removeOverlay();
    if (!document.documentElement.dataset.scheme) document.documentElement.dataset.scheme = "light";

    const wrap = h(".lock", { role: "dialog", "aria-modal": "true", "aria-label": "Enter password" });
    wrap.dataset.scheme = "lock";

    const card = h(".lock__card.m3e-state");
    card.appendChild(h(".lock__badge", { html: icon("lock", 26) }));
    card.appendChild(h("h1.lock__title", { text: "This archive is locked" }));
    card.appendChild(h("p.lock__sub", { text: "Enter the password to open your saved bookmarks." }));

    const form = h("form.lock__form");
    const input = h("input.lock__input", {
      type: "password", id: "lock-pass",
      autocomplete: "off", inputmode: "numeric",
      spellcheck: "false", "aria-label": "Password", placeholder: "Password",
    });
    const reveal = h("button.lock__reveal", { type: "button", "aria-label": "Show password", html: icon("seen", 18) });
    let revealed = false;
    reveal.addEventListener("click", () => {
      revealed = !revealed;
      input.type = revealed ? "text" : "password";
      reveal.setAttribute("aria-label", revealed ? "Hide password" : "Show password");
      reveal.classList.toggle("is-on", revealed);
      input.focus();
    });

    const field = h("label.lock__field", { for: "lock-pass" }, input, reveal);
    const err = h("p.lock__error", { role: "alert", "aria-live": "assertive" });
    const submit = h("button.m3e-button.m3e-button--filled.m3e-button--m.m3e-button--block", {
      type: "submit", html: icon("arrowRight", 18) + "<span>Unlock</span>",
    });

    form.appendChild(field);
    form.appendChild(err);
    form.appendChild(submit);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      err.textContent = "";
      if (input.value === PASSWORD) {
        markUnlocked();
        release();
        return;
      }
      err.textContent = "That password isn't right. Try again.";
      input.select();
      shake();
    });

    card.appendChild(form);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    lockEl = wrap;
    requestAnimationFrame(() => { wrap.classList.add("is-in"); input.focus({ preventScroll: true }); });
  }

  function shake() {
    if (!lockEl) return;
    const card = lockEl.querySelector(".lock__card");
    if (!card) return;
    card.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" },
       { transform: "translateX(8px)" }, { transform: "translateX(-5px)" },
       { transform: "translateX(5px)" }, { transform: "translateX(0)" }],
      { duration: 360, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)" }
    );
  }

  function release() {
    const boot = pendingBoot;
    pendingBoot = null;
    if (lockEl) { lockEl.classList.remove("is-in"); lockEl.classList.add("is-out"); }
    setTimeout(async () => {
      removeOverlay();
      if (boot) await boot();
    }, 220);
  }

  /* ------------------------------------------------------------- public API */

  function intercept(app) {
    installBootGate(app);
    root.XBLock = api;
    return api;
  }

  const api = { intercept };
  root.XBLock = api;
})(window);
