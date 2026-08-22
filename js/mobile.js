/* =============================================================================
   XBMobile — the mobile composition layer

   The desktop system is untouched. This module only adds what a touch phone
   needs that a pointer desktop doesn't, and every behaviour here is scoped to
   compact windows and/or touch pointers:

     · isCompact() / isTouch() — the two queries every adaptation branches on
     · the More sheet — Import / Settings / Capture as secondary destinations
     · dynamic bottom chrome — bottom nav hides on scroll down, returns on up
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon } = root.XBUI;

  /* ------------------------------------------------------------- queries -- */
  function isCompact() {
    return typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches;
  }

  function isTouch() {
    return typeof matchMedia === "function"
      ? !matchMedia("(hover: hover) and (pointer: fine)").matches
      : false;
  }

  /* States where the bottom chrome must never move: immersive feed, viewer,
     any open sheet or dialog, active selection. */
  function chromeLocked() {
    return document.body.classList.contains("is-watching") ||
      document.body.classList.contains("is-searching") ||
      (root.XBViewer && root.XBViewer.isOpen()) ||
      !!document.querySelector(".m3e-sheet[data-open='true'], .m3e-dialog[data-open='true']") ||
      document.querySelector(".stage.is-picking");
  }

  /* --------------------------------------------------------- more sheet -- */
  /** A shared product-voiced bottom sheet. Returns nothing; closes itself. */
  function sheet(title, contentNode) {
    const scrim = h(".m3e-scrim", { "data-open": "false" });
    const el = h(".m3e-sheet.m3e-sheet--bottom", {
      role: "dialog", "aria-modal": "true", "aria-label": title,
      "data-open": "false", "aria-hidden": "true", tabindex: "-1",
    });
    el.appendChild(h(".m3e-sheet__handle"));
    el.appendChild(h(".m3e-sheet__header",
      h(".m3e-sheet__title.t-title", { text: title }),
      h("button.ctl", { type: "button", text: "Done" })
    ));
    const content = h(".m3e-sheet__content", contentNode);
    el.appendChild(content);
    document.body.appendChild(scrim);
    document.body.appendChild(el);
    if (root.M3E && root.M3E.bindRipple) root.M3E.bindRipple(el);
    const done = el.querySelector(".m3e-sheet__header .ctl");
    const overlay = root.M3E.createOverlay({
      element: el, scrim,
      onClose: () => setTimeout(() => { el.remove(); scrim.remove(); }, 260),
    });
    done.addEventListener("click", () => overlay.close());
    overlay.open();
    return overlay;
  }

  const MORE_ENTRIES = [
    { id: "manage", icon: "manage", label: "Library management", desc: "Import, export and clean up" },
    { id: "settings", icon: "settings", label: "Settings", desc: "Theme, browsing and playback" },
    { id: "capture", icon: "inbox", label: "Capture", desc: "Extension status and failures" },
  ];

  /** More — the utility destinations behind one nav slot. */
  function openMore(app) {
    const list = h(".more-list");
    MORE_ENTRIES.forEach((entry) => {
      const row = h("button.more-row",
        { type: "button", html: icon(entry.icon, 20) },
        h("span", h("b", { text: entry.label }), h("small", { text: entry.desc }))
      );
      row.addEventListener("click", () => app.go(entry.id));
      list.appendChild(row);
    });
    sheet("More", list);
  }

  /* --------------------------------------------- dynamic bottom chrome -- */
  /**
   * Scroll down → the bottom nav softly hides; scroll up (or back to the top)
   * → it returns. Never hidden at the top of a page, in Watch/Viewer, under a
   * modal state, or during selection.
   */
  function bindNavAutoHide(navbar) {
    let lastY = root.scrollY;
    let frame = 0;

    function show() { navbar.dataset.hidden = "false"; }

    function update() {
      frame = 0;
      const y = Math.max(0, root.scrollY);
      const delta = y - lastY;

      if (chromeLocked()) { show(); lastY = y; return; }
      if (y < 120 || delta < -4) show();
      else if (delta > 8) navbar.dataset.hidden = "true";
      lastY = y;
    }

    root.addEventListener("scroll", () => {
      if (!frame) frame = requestAnimationFrame(update);
    }, { passive: true });

    /* Any new pointer interaction re-evaluates: opening a sheet while the nav
       is hidden must bring it back once the sheet closes. */
    document.addEventListener("pointerdown", () => {
      if (chromeLocked()) show();
    }, true);

    show();
  }

  root.XBMobile = { isCompact, isTouch, openMore, sheet, bindNavAutoHide };
})(window);
