/* AUTO-GENERATED — do not edit.
   Mirrored from dashboard/m3e/interactions.js by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
/* =============================================================================
   M3E · Interaction Runtime
   The behavioural half of the design system: ripples, focus management,
   scroll-linked chrome, snackbars, dialog/sheet lifecycle.

   Everything here is progressive: if the script fails to load, the CSS still
   renders correct static states and native focus still works.
   ============================================================================= */
(function (root, factory) {
  // Always publish on the global. A host that defines `module` must not prevent
  // classic <script> pages (popup, dashboard) from seeing window.M3E.
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.M3E = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RIPPLE_TARGETS =
    ".m3e-button, .m3e-icon-button, .m3e-chip, .m3e-fab, .m3e-card--interactive," +
    " .m3e-segmented__item, .m3e-list-item, .m3e-menu__item, .m3e-fab-menu__item," +
    " .m3e-switch, .m3e-nav-bar__item, .m3e-rail__item";

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
    " select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

  const reducedMotion = () =>
    (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced") ||
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---------------------------------------------------------------------------
     Ripple
     A single delegated listener; the ripple element is positioned at the
     pointer and scales out on the slow spatial spring.
     --------------------------------------------------------------------------- */
  function bindRipple(scope) {
    const host = scope || document;
    host.addEventListener(
      "pointerdown",
      (event) => {
        if (reducedMotion()) return;
        if (event.button !== 0 && event.pointerType === "mouse") return;
        const target = event.target.closest && event.target.closest(RIPPLE_TARGETS);
        if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") return;

        const rect = target.getBoundingClientRect();
        const diameter = Math.max(rect.width, rect.height) * 2;
        const ripple = document.createElement("span");
        ripple.className = "m3e-ripple";
        ripple.style.width = ripple.style.height = diameter + "px";
        ripple.style.left = event.clientX - rect.left - diameter / 2 + "px";
        ripple.style.top = event.clientY - rect.top - diameter / 2 + "px";

        const priorPosition = getComputedStyle(target).position;
        if (priorPosition === "static") target.style.position = "relative";
        if (getComputedStyle(target).overflow === "visible") target.style.overflow = "hidden";

        target.appendChild(ripple);
        ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
        setTimeout(() => ripple.remove(), 900);
      },
      { passive: true }
    );
  }

  /* ---------------------------------------------------------------------------
     Focus trap — required for role="dialog" with aria-modal="true"
     --------------------------------------------------------------------------- */
  function trapFocus(container) {
    let previouslyFocused = document.activeElement;

    const focusables = () =>
      Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        (el) =>
          (el.offsetParent !== null || el === document.activeElement) &&
          !el.closest("[inert]") // inert sub-surfaces are not part of the trap
      );

    const onKeydown = (event) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeydown);

    // Move focus in on the next frame so the entrance transition has begun.
    requestAnimationFrame(() => {
      const initial = container.querySelector("[data-autofocus]") || focusables()[0] || container;
      if (initial && initial.focus) initial.focus({ preventScroll: true });
    });

    return function release(restoreFocus) {
      container.removeEventListener("keydown", onKeydown);
      if (restoreFocus !== false && previouslyFocused && previouslyFocused.focus) {
        previouslyFocused.focus({ preventScroll: true });
      }
      previouslyFocused = null;
    };
  }

  /* ---------------------------------------------------------------------------
     Overlay controller — one lifecycle for dialogs, bottom sheets, side sheets.
     Handles scrim, focus trap, Escape, scroll lock and the aria bookkeeping.
     --------------------------------------------------------------------------- */
  function createOverlay(options) {
    const el = options.element;
    const scrim = options.scrim || null;
    const onClose = options.onClose || null;
    let release = null;
    let open = false;

    const close = () => {
      if (!open) return;
      open = false;
      el.dataset.open = "false";
      el.setAttribute("aria-hidden", "true");
      if (scrim) scrim.dataset.open = "false";
      if (release) { release(options.restoreFocus); release = null; }
      document.documentElement.style.removeProperty("overflow");
      if (onClose) onClose();
    };

    const show = () => {
      if (open) return;
      open = true;
      el.dataset.open = "true";
      el.setAttribute("aria-hidden", "false");
      if (scrim) scrim.dataset.open = "true";
      if (options.lockScroll !== false) document.documentElement.style.overflow = "hidden";
      release = trapFocus(el);
    };

    if (scrim && options.dismissOnScrim !== false) scrim.addEventListener("click", close);
    el.addEventListener("keydown", (event) => {
      /* Escape while typing in a field is the field's own clear/cancel; it
         must not dismiss the whole surface out from under someone mid-edit. */
      if (event.key === "Escape" && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
        event.stopPropagation(); close();
      }
    });

    return { open: show, close, get isOpen() { return open; } };
  }

  /* ---------------------------------------------------------------------------
     Snackbar queue
     One live region, serialised messages, action support, polite by default.
     --------------------------------------------------------------------------- */
  function createSnackbar(element) {
    const textEl = element.querySelector(".m3e-snackbar__text");
    const actionEl = element.querySelector(".m3e-snackbar__action");
    const queue = [];
    let timer = null;
    let showing = false;

    function next() {
      if (showing || !queue.length) return;
      const item = queue.shift();
      showing = true;

      textEl.textContent = item.message;
      element.classList.toggle("m3e-snackbar--error", !!item.error);
      // Errors are assertive so a screen reader interrupts; the rest is polite.
      element.setAttribute("aria-live", item.error ? "assertive" : "polite");

      if (item.action && item.onAction) {
        actionEl.hidden = false;
        actionEl.textContent = item.action;
        actionEl.onclick = () => { item.onAction(); dismiss(); };
      } else {
        actionEl.hidden = true;
        actionEl.onclick = null;
      }

      element.dataset.open = "true";
      clearTimeout(timer);
      timer = setTimeout(dismiss, item.duration || (item.action ? 8000 : 4500));
    }

    function dismiss() {
      clearTimeout(timer);
      element.dataset.open = "false";
      setTimeout(() => { showing = false; next(); }, 220);
    }

    return {
      show(message, opts) {
        queue.push(Object.assign({ message: String(message) }, opts || {}));
        next();
      },
      dismiss,
    };
  }

  /* ---------------------------------------------------------------------------
     Anchored menu
     Positions relative to its trigger, flips when it would overflow, closes on
     outside click / Escape, and supports full arrow-key roving focus.
     --------------------------------------------------------------------------- */
  function openMenu(trigger, menu, options) {
    const opts = options || {};
    const rect = trigger.getBoundingClientRect();

    menu.hidden = false;
    menu.style.visibility = "hidden";
    menu.style.position = "fixed";
    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const align = opts.align === "end" ? "end" : "start";

    let left = align === "end" ? rect.right - menuRect.width : rect.left;
    let top = rect.bottom + 8;
    if (left + menuRect.width > innerWidth - 8) left = innerWidth - menuRect.width - 8;
    if (left < 8) left = 8;

    /* Prefer below the trigger; flip above when it doesn't fit. Whichever
       side is chosen, the menu is then capped to the space actually
       available — the previous `Math.max(8, …)` clamped the top edge but let
       a tall menu run off the bottom of the window, which only became
       reachable once a menu grew past a screen height. */
    const below = innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    if (menuRect.height > below && above > below) {
      // Flip above the trigger: there is more room there.
      menu.style.maxHeight = above + "px";
      top = Math.max(8, rect.top - Math.min(menuRect.height, above) - 8);
    } else {
      // Stay below, but never taller than the space that exists. Without the
      // cap a menu can run off the bottom of the window, and the items past
      // the fold become unreachable — no amount of scrolling brings back
      // something rendered outside the viewport.
      menu.style.maxHeight = Math.max(120, below) + "px";
    }

    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.visibility = "";
    trigger.setAttribute("aria-expanded", "true");

    const items = () => Array.from(menu.querySelectorAll(".m3e-menu__item:not([disabled])"));
    let index = Math.max(0, items().findIndex((el) => el.getAttribute("aria-selected") === "true"));
    const focusAt = (i) => {
      const list = items();
      if (!list.length) return;
      index = (i + list.length) % list.length;
      list[index].focus();
    };
    requestAnimationFrame(() => focusAt(index));

    function close() {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      menu.remove();
      trigger.setAttribute("aria-expanded", "false");
      if (opts.onClose) opts.onClose();
      if (opts.restoreFocus !== false) trigger.focus({ preventScroll: true });
    }

    function onOutside(event) {
      if (!menu.contains(event.target) && !trigger.contains(event.target)) close();
    }
    function onKey(event) {
      switch (event.key) {
        case "Escape": event.preventDefault(); close(); break;
        case "ArrowDown": event.preventDefault(); focusAt(index + 1); break;
        case "ArrowUp": event.preventDefault(); focusAt(index - 1); break;
        case "Home": event.preventDefault(); focusAt(0); break;
        case "End": event.preventDefault(); focusAt(items().length - 1); break;
        case "Tab": close(); break;
        default: break;
      }
    }

    /* A menu is anchored to its trigger, so it must close if the page scrolls
       out from under it. But the listener is in the CAPTURE phase, which also
       sees scrolling *inside* the menu itself — and a menu tall enough to
       scroll then closes the instant a user reaches for a lower item. Ignore
       scroll events originating within the menu. */
    function onScroll(event) {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      close();
    }

    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);

    return { close };
  }

  /* ---------------------------------------------------------------------------
     Scroll-linked chrome
     - App bar lifts to surface-container once content passes under it.
     - Extended FAB collapses to icon-only while scrolling down, expands on up.
     - Floating toolbar hides on scroll down, returns on scroll up.
     --------------------------------------------------------------------------- */
  function bindScrollChrome(config) {
    const appBar = config.appBar || null;
    const fab = config.fab || null;
    const toolbar = config.toolbar || null;
    const threshold = config.threshold || 8;
    let lastY = 0;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;

      if (appBar) appBar.dataset.scrolled = y > threshold ? "true" : "false";
      if (fab && Math.abs(delta) > 4) fab.dataset.collapsed = delta > 0 && y > 120 ? "true" : "false";
      if (toolbar && Math.abs(delta) > 6) toolbar.dataset.hidden = delta > 0 && y > 160 ? "true" : "false";

      lastY = y;
    };

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }

  /* ---------------------------------------------------------------------------
     Window size class  (M3 adaptive breakpoints)
       compact < 600 · medium < 840 · expanded < 1200 · large < 1600 · xlarge
     Written to <html data-window-class> so layout CSS can key off one attribute.
     --------------------------------------------------------------------------- */
  const BREAKPOINTS = [
    { name: "compact", max: 599 },
    { name: "medium", max: 839 },
    { name: "expanded", max: 1199 },
    { name: "large", max: 1599 },
    { name: "extra-large", max: Infinity },
  ];

  function windowClass(width) {
    const w = typeof width === "number" ? width : window.innerWidth;
    return BREAKPOINTS.find((b) => w <= b.max).name;
  }

  function bindWindowClass(onChange) {
    let current = null;
    const update = () => {
      const next = windowClass();
      if (next === current) return;
      current = next;
      document.documentElement.dataset.windowClass = next;
      if (onChange) onChange(next);
    };
    window.addEventListener("resize", update, { passive: true });
    update();
    return () => window.removeEventListener("resize", update);
  }

  /* ---------------------------------------------------------------------------
     Roving tabindex — one tab stop per composite widget (WAI-ARIA APG)
     --------------------------------------------------------------------------- */
  function bindRovingFocus(container, itemSelector, options) {
    const orientation = (options && options.orientation) || "horizontal";
    const nextKeys = orientation === "vertical" ? ["ArrowDown"] : ["ArrowRight"];
    const prevKeys = orientation === "vertical" ? ["ArrowUp"] : ["ArrowLeft"];

    const items = () => Array.from(container.querySelectorAll(itemSelector));

    const sync = () => {
      const list = items();
      const activeIndex = Math.max(
        0,
        list.findIndex((el) => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true")
      );
      list.forEach((el, i) => el.setAttribute("tabindex", i === activeIndex ? "0" : "-1"));
    };

    container.addEventListener("keydown", (event) => {
      const list = items();
      const at = list.indexOf(document.activeElement);
      if (at < 0) return;
      let to = -1;
      if (nextKeys.includes(event.key)) to = (at + 1) % list.length;
      else if (prevKeys.includes(event.key)) to = (at - 1 + list.length) % list.length;
      else if (event.key === "Home") to = 0;
      else if (event.key === "End") to = list.length - 1;
      if (to < 0) return;
      event.preventDefault();
      list.forEach((el, i) => el.setAttribute("tabindex", i === to ? "0" : "-1"));
      list[to].focus();
    });

    sync();
    return sync;
  }

  /* ---------------------------------------------------------------------------
     Switch — a button[role=switch] with keyboard parity
     --------------------------------------------------------------------------- */
  function bindSwitch(element, onChange) {
    const toggle = () => {
      const next = element.getAttribute("aria-checked") !== "true";
      element.setAttribute("aria-checked", String(next));
      if (onChange) onChange(next);
    };
    element.addEventListener("click", toggle);
    element.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggle(); }
    });
    return toggle;
  }

  /* ---------------------------------------------------------------------------
     Carousel controller

     Owns the behaviour an M3 carousel needs beyond what CSS scroll-snap gives
     for free:

       · arrow buttons that page by a viewport, and disable at each end;
       · a scroll-extent indicator, since the scrollbar is suppressed;
       · keyboard parity — Arrow keys, Home and End move the rail, because a
         horizontally scrolling region that can only be driven by a mouse
         wheel or a swipe is unusable without one (WCAG 2.1.1);
       · wheel translation, so a vertical trackpad flick over a rail scrolls
         the rail rather than the page.

     Everything is passive and rAF-coalesced: a page can hold a dozen rails.
     --------------------------------------------------------------------------- */
  function bindCarousel(scroller, options) {
    if (!scroller) return { destroy() {}, update() {} };
    const opts = options || {};
    const prev = opts.prev || null;
    const next = opts.next || null;
    const progress = opts.progress || null;
    let frame = 0;

    const maxScroll = () => Math.max(0, scroller.scrollWidth - scroller.clientWidth);

    const update = () => {
      frame = 0;
      const max = maxScroll();
      const x = scroller.scrollLeft;
      // 1px of slack: sub-pixel layout means scrollLeft rarely hits max exactly,
      // which would leave the "next" arrow enabled forever at the end.
      if (prev) prev.disabled = x <= 1;
      if (next) next.disabled = x >= max - 1;

      if (progress) {
        const extent = scroller.scrollWidth ? scroller.clientWidth / scroller.scrollWidth : 1;
        progress.parentElement.hidden = extent >= 0.999;
        progress.style.setProperty("--m3e-extent", (extent * 100).toFixed(2) + "%");
        progress.style.setProperty(
          "--m3e-offset",
          (scroller.scrollWidth ? (x / scroller.scrollWidth) * 100 : 0).toFixed(2) + "%"
        );
      }
    };

    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

    /* A page is one viewport minus a sliver, so the item that was at the edge
       stays visible and gives the eye something to anchor to. Paging by the
       full width makes every step feel like a jump cut. */
    const page = (direction) => {
      const step = Math.max(120, scroller.clientWidth * 0.85);
      scroller.scrollBy({
        left: direction * step,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    };

    if (prev) prev.addEventListener("click", () => page(-1));
    if (next) next.addEventListener("click", () => page(1));

    scroller.addEventListener("scroll", schedule, { passive: true });

    scroller.addEventListener("keydown", (event) => {
      // Only when the rail itself (or a non-input child) has focus; a text
      // field inside a rail must keep its own arrow keys.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      switch (event.key) {
        case "ArrowRight": event.preventDefault(); page(1); break;
        case "ArrowLeft": event.preventDefault(); page(-1); break;
        case "Home":
          event.preventDefault();
          scroller.scrollTo({ left: 0, behavior: reducedMotion() ? "auto" : "smooth" });
          break;
        case "End":
          event.preventDefault();
          scroller.scrollTo({ left: maxScroll(), behavior: reducedMotion() ? "auto" : "smooth" });
          break;
        default: break;
      }
    });

    /* Translate a vertical wheel into horizontal scroll — but only while the
       rail still has somewhere to go in that direction, so reaching the end of
       a rail hands the gesture back to the page instead of trapping it. A
       trackpad user who is already scrolling horizontally (deltaX) is left
       completely alone. */
    scroller.addEventListener(
      "wheel",
      (event) => {
        if (event.deltaX !== 0 || event.ctrlKey) return;
        const max = maxScroll();
        if (max <= 0) return;
        const going = Math.sign(event.deltaY);
        const at = going > 0 ? scroller.scrollLeft >= max - 1 : scroller.scrollLeft <= 1;
        if (at) return;
        event.preventDefault();
        scroller.scrollLeft += event.deltaY;
      },
      { passive: false }
    );

    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(schedule);
      ro.observe(scroller);
      update();
      return { update: schedule, destroy: () => ro.disconnect() };
    }

    update();
    return { update: schedule, destroy() {} };
  }

  /* ---------------------------------------------------------------------------
     Escape key — view-level exit

     One document-level listener for "leave this mode" behaviour (the theater).
     Escape is owned first by whoever already claimed it: overlays and the
     lightbox stop propagation, menus close themselves in the capture phase
     and mark the event handled, and a form field keeps Escape for its own
     clear/cancel meaning. Only when none of those applied does the handler
     run, so a global listener can exist without stealing the key from the
     surfaces that legitimately use it.
     --------------------------------------------------------------------------- */
  function bindEscape(handler) {
    const onKeydown = (event) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      handler(event);
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }

  /* Same idea, but in the CAPTURE phase, so it runs before any bubble-phase
     listener — including an open overlay's own Escape handler. A nested
     sub-surface (the lightbox's grid overview) uses this to take the first
     turn at Escape and close itself, leaving its parent open. */
  function bindEscapeCapture(handler) {
    const onKeydown = (event) => {
      if (event.key !== "Escape") return;
      handler(event);
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => document.removeEventListener("keydown", onKeydown, true);
  }

  /* ---------------------------------------------------------------------------
     Utilities
     --------------------------------------------------------------------------- */
  function pulse(element) {
    if (!element || reducedMotion()) return;
    element.classList.remove("m3e-pulse");
    void element.offsetWidth; // force reflow so the animation restarts
    element.classList.add("m3e-pulse");
  }

  function debounce(fn, wait) {
    let t = null;
    return function debounced() {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Escape untrusted text for innerHTML interpolation. */
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  return {
    bindRipple,
    trapFocus,
    createOverlay,
    createSnackbar,
    openMenu,
    bindScrollChrome,
    bindWindowClass,
    windowClass,
    bindRovingFocus,
    bindSwitch,
    bindCarousel,
    bindEscape,
    bindEscapeCapture,
    pulse,
    debounce,
    escapeHtml,
    reducedMotion,
    BREAKPOINTS,
    FOCUSABLE,
  };
});
