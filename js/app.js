/* =============================================================================
   XBApp — the shell and the router

   Everything durable lives in XBState; everything visible lives in a view
   module. This file is the thin, boring layer in between:

     · the navigation rail / bottom bar
     · the top bar: search command centre, capture status, contextual actions
     · one repaint pipeline (state changes -> re-render the current workspace)
     · the services every view asks for: toast, confirm, prompt, viewer, export

   It deliberately owns no product logic. If something here starts making
   decisions about *what* to show, it belongs in a view.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, num, clear, button } = root.XBUI;
  const St = root.XBState;

  /* ------------------------------------------------------------------ nav -- */
  const PRIMARY = [
    { id: "discover", label: "Discover", icon: "discover" },
    { id: "library", label: "Library", icon: "library" },
    { id: "watch", label: "Watch", icon: "watch" },
  ];

  const UTILITY = [
    { id: "manage", label: "Import", icon: "manage" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  const TITLES = {
    discover: "Discover",
    library: "Library",
    watch: "Watch",
    settings: "Settings",
    manage: "Library management",
    capture: "Capture",
  };

  /* Offered in the search panel. Each is a filter someone actually wants at
     the moment they are typing — not the whole filter vocabulary. */
  const SUGGESTIONS = [
    { label: "Only videos", key: "kind", value: "video" },
    { label: "Only photos", key: "kind", value: "photo" },
    { label: "GIFs", key: "kind", value: "gif" },
    { label: "Never opened", key: "seen", value: "unseen" },
    { label: "In progress", key: "progress", value: "yes" },
    { label: "Has alt text", key: "alt", value: "yes" },
    { label: "Portrait", key: "shape", value: "portrait" },
  ];

  const els = {};
  let theme = null;
  let snackbar = null;
  let searchOpen = false;
  let searchDebounce = 0;
  let scrollDebounce = 0;
  let lastWorkspace = null;
  let frame = 0;

  /* ==========================================================================
     Boot
     ========================================================================== */
  async function boot() {
    cacheEls();

    await St.load();
    St.readUrl();

    /* Every fresh dashboard load is a new discovery cycle, so Discover surfaces
     * different content each time — and a new Library random seed, so the
     * default ordering is fresh too. Both are stable for the rest of the
     * session. Done before subscribe so their notifies are no-ops. */
    St.newDiscoveryCycle();
    St.rollSessionRandom();

    theme = root.M3ETheme.createController(themeSettings(), () => {
      syncChrome();
      /* The scheme may have flipped with the OS; product colours are CSS, but
         the browser chrome colour is not. */
      repaint();
    });
    syncChrome();

    buildRail();
    buildTopbar();
    buildNavbar();

    snackbar = root.M3E.createSnackbar(els.snackbar);
    root.M3E.bindScrollChrome({ appBar: els.topbar });
    root.M3E.bindWindowClass();
    bindGlobalKeys();
    bindScrollMemory();
    bindPointer();

    St.subscribe(onStateChange);
    root.XBStore.onChanged(onStorageChange);
    root.addEventListener("xb-storage-error", onStorageError);
    root.addEventListener("hashchange", () => {
      if (St.readUrl()) repaint();
    });

    document.body.classList.remove("is-booting");
    repaint();
    restoreScroll(true);
  }

  /**
   * Things outside the CSS cascade that still have to follow the theme: the
   * browser's own chrome colour, and the control-size accessibility flag.
   * The product palette is fixed CSS, so theme-color reads the same tokens.
   */
  function syncChrome() {
    const dark = document.documentElement.dataset.scheme === "dark";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0B0B0F" : "#FAF9FC");
    document.documentElement.dataset.controls = St.state.prefs.largeControls ? "large" : "normal";
    syncPointer();
  }

  /* Interaction contract, made explicit rather than left to emerge from CSS.
     `data-pointer` on the root records the primary input model so any
     component can branch: hover devices reveal secondary info on hover;
     touch surfaces can't, and fall back to always-visible affordances.
     Re-evaluated whenever the browser reports a change of primary pointer. */
  function syncPointer() {
    const canHover = typeof matchMedia === "function"
      ? matchMedia("(hover: hover) and (pointer: fine)").matches
      : true;
    document.documentElement.dataset.pointer = canHover ? "hover" : "touch";
  }

  function themeSettings() {
    const p = St.state.prefs;
    return {
      seed: p.seed || root.M3ETheme.DEFAULTS.seed,
      variant: p.variant || root.M3ETheme.DEFAULTS.variant,
      contrast: p.contrast || "standard",
      scheme: p.themeScheme || "system",
      density: p.density || "comfortable",
      reducedMotion: !!p.reduceMotion,
    };
  }

  function cacheEls() {
    els.rail = document.getElementById("rail");
    els.navbar = document.getElementById("navbar");
    els.topbar = document.getElementById("topbar");
    els.stage = document.getElementById("stage");
    els.snackbar = document.getElementById("snackbar");
  }

  /* ==========================================================================
     Navigation
     ========================================================================== */
  function navItem(entry, cls) {
    const el = h("button." + cls, {
      type: "button",
      role: "tab",
      "aria-selected": "false",
      "data-workspace": entry.id,
      title: entry.label,
    });
    el.appendChild(h("span.rail__pill", { html: icon(entry.icon, 20) }));
    el.appendChild(h("span", { text: entry.label }));
    el.addEventListener("click", () => go(entry.id));
    return el;
  }

  function buildRail() {
    clear(els.rail);
    els.rail.setAttribute("role", "tablist");

    const brand = h(".rail__brand", { html: icon("mark", 22), title: "X Bookmarks" });
    els.rail.appendChild(brand);

    const main = h(".rail__group");
    PRIMARY.forEach((e) => main.appendChild(navItem(e, "rail__item")));
    els.rail.appendChild(main);

    els.rail.appendChild(h(".rail__spacer"));
    els.rail.appendChild(h(".rail__rule"));

    const util = h(".rail__group");
    UTILITY.forEach((e) => util.appendChild(navItem(e, "rail__item")));
    els.rail.appendChild(util);
  }

  function buildNavbar() {
    clear(els.navbar);
    els.navbar.setAttribute("role", "tablist");
    /* Four destinations only. Discover / Library / Watch are primary product
       jobs; everything utility lives behind More (see XBMobile.openMore). */
    PRIMARY.forEach((e) => els.navbar.appendChild(navItem(e, "navbar__item")));
    const more = h("button.navbar__item", {
      type: "button", role: "tab", "aria-selected": "false", title: "More",
      "data-workspace": "more",
    });
    more.appendChild(h("span.rail__pill", { html: icon("more", 20) }));
    more.appendChild(h("span", { text: "More" }));
    more.addEventListener("click", () => root.XBMobile.openMore(app));
    els.navbar.appendChild(more);

    if (root.XBMobile) root.XBMobile.bindNavAutoHide(els.navbar);
  }

  function updateNav() {
    const w = St.state.workspace;
    /* Capture is reached from the status chip, not the rail — but while you
       are there the rail should not look like nothing is selected. */
    const equivalent = ["manage", "settings", "capture"].includes(w) ? "more" : w;
    document.querySelectorAll("[data-workspace]").forEach((el) => {
      el.setAttribute("aria-selected", String(el.dataset.workspace === equivalent));
    });

    const failed = St.state.dead.length;
    els.rail.querySelectorAll(".rail__dot").forEach((d) => d.remove());
    if (failed) {
      const host = els.rail.querySelector('[data-workspace="manage"]');
      if (host) host.appendChild(h(".rail__dot", { "aria-hidden": "true" }));
    }
  }

  /* ==========================================================================
     Top bar
     ========================================================================== */
  function buildTopbar() {
    clear(els.topbar);

    els.topbar.appendChild(h(".topbar__mark", { html: icon("mark", 19), "aria-hidden": "true" }));
    els.topbar.appendChild(buildSearch());

    els.actions = h(".topbar__actions");
    els.topbar.appendChild(els.actions);
  }

  function buildSearch() {
    const input = h("input", {
      type: "search",
      id: "q",
      placeholder: "Search your archive",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Search your archive",
      "aria-expanded": "false",
    });
    els.input = input;

    const clearBtn = h("button.search__clear", {
      type: "button", "aria-label": "Clear search", html: icon("close", 12),
    });
    clearBtn.addEventListener("click", () => {
      input.value = "";
      St.set({ search: "" });
      input.focus();
    });

    const box = h(".search__box",
      h("span", { html: icon("search", 18), "aria-hidden": "true" }),
      input,
      clearBtn,
      h("span.search__kbd", { text: "/", "aria-hidden": "true" })
    );

    const wrap = h(".search", box);
    els.search = wrap;

    input.addEventListener("input", () => {
      wrap.classList.toggle("has-value", !!input.value);
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        St.set({ search: input.value }, "search");
        if (searchOpen) paintSearchPanel();
      }, 160);
    });

    input.addEventListener("focus", () => openSearch());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (input.value) { input.value = ""; St.set({ search: "" }); }
        else { closeSearch(); input.blur(); }
      } else if (e.key === "Enter") {
        St.pushRecentSearch(input.value);
        clearTimeout(searchDebounce);
        St.set({ search: input.value, workspace: input.value ? "library" : St.state.workspace }, "search");
        closeSearch();
        input.blur();
      }
    });

    document.addEventListener("pointerdown", (e) => {
      if (searchOpen && !wrap.contains(e.target) &&
          !(els.panel && els.panel.contains(e.target))) closeSearch();
    });

    return wrap;
  }

  function openSearch() {
    if (searchOpen) return;
    searchOpen = true;
    els.search.classList.add("is-open");
    els.input.setAttribute("aria-expanded", "true");
    if (root.XBMobile.isCompact()) document.body.classList.add("is-searching");
    paintSearchPanel();
  }

  function closeSearch() {
    if (!searchOpen) return;
    searchOpen = false;
    els.search.classList.remove("is-open");
    document.body.classList.remove("is-searching");
    els.input.setAttribute("aria-expanded", "false");
    if (els.panel) { els.panel.remove(); els.panel = null; }
  }

  /**
   * The command centre. It answers three questions at once: what am I
   * searching, how much did it find, and what could I narrow it to next.
   */
  function paintSearchPanel() {
    if (els.panel) els.panel.remove();
    const s = St.state;
    const panel = h(".search__panel", { role: "dialog", "aria-label": "Search" });

    /* Mobile: the panel is a full-width sheet mounted on <body> — the topbar's
       backdrop-filter would otherwise become its containing block. */
    const compact = root.XBMobile.isCompact();
    if (compact) {
      const back = h("button.search__back", { type: "button", html: icon("arrowLeft", 20) + "<span>Search your archive</span>" });
      back.addEventListener("click", () => { closeSearch(); els.input.blur(); });
      panel.appendChild(back);
    }

    const total = St.derived.all.length;
    const hits = St.derived.items.length;
    panel.appendChild(h(".search__scope",
      h("b", { text: s.search ? num(hits) + (hits === 1 ? " match" : " matches") : "Everything" }),
      h("span.dimmer.t-body-s", { text: s.search ? "in " + num(total) + " items" : num(total) + " items in your archive" })
    ));

    const recents = (s.prefs.recentSearches || []).filter((r) => r !== s.search);
    if (recents.length) {
      const chips = h(".search__chips");
      recents.slice(0, 6).forEach((term) => {
        const b = h("button.pill", { type: "button", html: icon("clock", 13) + "<span>" + esc(term) + "</span>" });
        b.addEventListener("click", () => {
          els.input.value = term;
          els.search.classList.add("has-value");
          St.set({ search: term, workspace: "library" }, "search");
          closeSearch();
        });
        chips.appendChild(b);
      });
      panel.appendChild(h(".search__group", h("p", { text: "Recent" }), chips));
    }

    const chips = h(".search__chips");
    SUGGESTIONS.forEach((sg) => {
      const on = String(s.filters[sg.key] || "") === sg.value;
      const b = h("button.pill", { type: "button", "aria-pressed": String(on), text: sg.label });
      b.addEventListener("click", () => {
        St.setFilter(sg.key, on ? null : sg.value);
        St.set({ workspace: "library" });
        paintSearchPanel();
      });
      chips.appendChild(b);
    });
    panel.appendChild(h(".search__group", h("p", { text: "Narrow to" }), chips));

    panel.appendChild(h(".search__foot",
      h("span", { html: "Searches captions, creators and alt text" }),
      h("span", { html: "<kbd>↵</kbd> open in Library · <kbd>esc</kbd> close" })
    ));

    if (compact) document.body.appendChild(panel);
    else els.search.appendChild(panel);
    els.panel = panel;
    if (compact) requestAnimationFrame(() => els.input.focus({ preventScroll: true }));
  }

  /**
   * Contextual actions only. Anything that belongs to a workspace lives in
   * that workspace — the top bar carries what is true everywhere plus, at
   * most, one thing about where you are.
   */
  function updateActions() {
    const s = St.state;
    clear(els.actions);

    if (s.workspace === "library" && s.selection.size === 0) {
      const n = St.activeFilterCount();
      if (n) {
        const b = h("button.ctl.ctl--on", {
          type: "button",
          html: icon("filter", 16) + "<span>" + n + " active</span>",
          title: "Clear all filters",
        });
        b.addEventListener("click", () => St.clearFilters());
        els.actions.appendChild(b);
      }
    }

    if (s.workspace === "manage" || s.workspace === "capture") {
      els.actions.appendChild(button("ctl", {
        icon: "refresh", label: "Refresh",
        on: async () => { await St.reloadFromStorage(); toast("Reloaded from storage"); },
      }));
    }
  }

  /* ==========================================================================
     Repaint pipeline
     ========================================================================== */
  function onStateChange(reason) {
    if (reason === "selection") { updateBulk(); markSelection(); return; }
    repaint();
  }

  function onStorageChange(changes) {
    /* Another surface (the popup, or a live capture) wrote to storage. Only
       react to keys we render, and never while the user is mid-gesture in the
       viewer — the refresh would yank the item out from under them. */
    const keys = Object.keys(changes || {});
    const relevant = !keys.length || keys.some((k) => k === root.XBStore.KEYS.bookmarks ||
      k === root.XBStore.KEYS.capture || k === root.XBStore.KEYS.dead);
    if (!relevant || root.XBViewer.isOpen()) return;
    St.reloadFromStorage();
  }

  function repaint() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  function paint() {
    const s = St.state;
    const w = s.workspace;

    if (lastWorkspace && lastWorkspace !== w) saveScroll(lastWorkspace);

    document.body.classList.toggle("is-watching", w === "watch");
    document.title = TITLES[w] + " · X Bookmarks";

    if (els.input && els.input.value !== s.search && document.activeElement !== els.input) {
      els.input.value = s.search;
      els.search.classList.toggle("has-value", !!s.search);
    }

    updateNav();
    updateActions();

    if (lastWorkspace === "watch" && w !== "watch") root.XBWatch.teardown();

    clear(els.stage);
    renderWorkspace(w);
    markSelection();
    updateBulk();
    St.writeUrl();

    if (lastWorkspace !== w) {
      lastWorkspace = w;
      restoreScroll(false);
    }
    if (root.XBViewer.isOpen()) root.XBViewer.repaint();
  }

  function renderWorkspace(w) {
    const api = app;
    if (w === "discover") return root.XBDiscover.render(els.stage, api);
    if (w === "library") return root.XBLibraryView.render(els.stage, api);
    if (w === "watch") return root.XBWatch.render(els.stage, api);
    if (w === "settings") return withHead("Settings", "Everything is saved as you change it.", () => root.XBSettings.render(els.stage, api));
    if (w === "manage") return withHead("Library management", "Move your archive in and out, see what it costs, and clean up what's broken.", () => root.XBManage.render(els.stage, api));
    if (w === "capture") return withHead("Capture", "What the extension collected, and anything it couldn't.", () => root.XBCapture.render(els.stage, api));
    return root.XBDiscover.render(els.stage, api);
  }

  function withHead(title, sub, render) {
    els.stage.appendChild(h(".page-head",
      h("h1", { text: title }),
      h("p.dim.t-body", { text: sub })
    ));
    render();
  }

  /* ==========================================================================
     Selection toolbar
     ========================================================================== */
  function markSelection() {
    const sel = St.state.selection;
    /* Once one item is picked, every checkbox becomes visible — otherwise
       multi-select means hunting for an affordance that only appears on hover. */
    els.stage.classList.toggle("is-picking", sel.size > 0);
    els.stage.querySelectorAll(".card[data-id]").forEach((el) => {
      el.classList.toggle("is-selected", sel.has(el.dataset.id));
    });
  }

  function updateBulk() {
    const sel = St.state.selection;
    if (els.bulk) { els.bulk.remove(); els.bulk = null; }
    if (!sel.size) return;

    const ids = Array.from(sel);
    const items = St.derived.all.filter((i) => sel.has(i.id));
    const allArchived = items.length > 0 && items.every((i) => i.archived);

    const bar = h(".bulk", { role: "toolbar", "aria-label": "Selection actions" });
    bar.appendChild(h("span.bulk__count.num", { text: num(sel.size) + " selected" }));

    bar.appendChild(button("ctl", {
      icon: "seen",
      label: "Mark seen",
      on: () => {
        /* Undo restores only the items this action actually flipped. */
        const flipped = items.filter((i) => i.unseen).map((i) => i.id);
        St.setSeen(ids, true);
        toast(num(ids.length) + " marked as seen", {
          action: "Undo",
          onAction: () => St.setSeen(flipped, false),
        });
      },
    }));
    bar.appendChild(button("ctl", {
      icon: allArchived ? "unarchive" : "archive",
      label: allArchived ? "Unarchive" : "Archive",
      on: () => {
        const flipped = items.filter((i) => !i.archived).map((i) => i.id);
        St.setArchived(ids, !allArchived);
        toast(allArchived ? "Unarchived" : "Archived", {
          action: "Undo",
          onAction: () => St.setArchived(flipped.length ? flipped : ids, allArchived),
        });
      },
    }));
    bar.appendChild(button("ctl", { icon: "download", label: "Export", on: () => exportItems(items) }));

    bar.appendChild(h(".bulk__sep", { "aria-hidden": "true" }));

    bar.appendChild(button("ctl ctl--danger", {
      icon: "trash", label: "Delete",
      on: () => confirmDialog({
        title: "Delete " + num(ids.length) + (ids.length === 1 ? " item?" : " items?"),
        body: "They are removed from this library. The posts stay on X, and you can undo this right after.",
        confirm: "Delete",
        danger: true,
        onConfirm: () => {
          const snapshot = St.removeItems(ids);
          toast(num(ids.length) + " deleted", {
            action: "Undo", onAction: () => { St.restore(snapshot); toast("Restored"); },
          });
        },
      }),
    }));

    bar.appendChild(button("iconctl", { icon: "close", iconSize: 18, aria: "Clear selection", on: () => St.clearSelection() }));

    document.body.appendChild(bar);
    els.bulk = bar;
  }

  /* ==========================================================================
     Scroll memory
     ========================================================================== */
  function bindScrollMemory() {
    root.addEventListener("scroll", () => {
      clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(() => saveScroll(St.state.workspace), 260);
    }, { passive: true });
  }

  function bindPointer() {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(hover: hover) and (pointer: fine)");
    const handler = () => syncPointer();
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  function saveScroll(workspace) {
    if (!workspace || workspace === "watch") return;
    const positions = St.state.prefs.scrollPositions || {};
    positions[workspace] = Math.round(root.scrollY);
    St.state.prefs.scrollPositions = positions;
    root.XBStore.savePrefs(St.state.prefs);
  }

  function restoreScroll(initial) {
    const s = St.state;
    if (!s.prefs.restoreSession) { if (!initial) root.scrollTo({ top: 0 }); return; }
    const y = (s.prefs.scrollPositions || {})[s.workspace] || 0;
    requestAnimationFrame(() => root.scrollTo({ top: y, behavior: "auto" }));
  }

  /* ==========================================================================
     Global keys
     ========================================================================== */
  function typing(target) {
    return target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
  }

  function bindGlobalKeys() {
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (root.XBViewer.isOpen()) return;      // the viewer owns its own keys
      if (typing(e.target)) return;

      const k = e.key;
      if (k === "/") { e.preventDefault(); els.input.focus(); els.input.select(); return; }
      if (k === "Escape") {
        if (St.state.workspace === "watch") { go(St.state.prefs.lastWorkspace || "discover"); return; }
        St.clearSelection();
        closeSearch();
        return;
      }
      /* Watch owns navigation within the feed; everything else still works so
         the feed is never a room without a door. */
      if (St.state.workspace === "watch" && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight| |j|k|m)$/.test(k)) return;

      if (k === "d" || k === "D") go("discover");
      else if (k === "l" || k === "L") go("library");
      else if (k === "w" || k === "W") go("watch");
      else if (k === "f" || k === "F") { go("library"); St.set({ filtersOpen: !St.state.filtersOpen }, "force"); }
      else if (k === "s" || k === "S") {
        go("library");
        requestAnimationFrame(() => {
          const btn = els.stage.querySelector("[data-lib-sort]");
          if (btn) btn.click();
        });
      } else if (k === "?") {
        go("settings");
        requestAnimationFrame(() => {
          const target = document.getElementById("pg-shortcuts");
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    });
  }

  /* ==========================================================================
     Services offered to views
     ========================================================================== */
  function go(workspace, patch) {
    const s = St.state;
    if (patch && patch.filters) { s.filters = Object.assign({}, patch.filters); }
    if (patch && patch.search != null) {
      s.search = patch.search;
      if (els.input) els.input.value = patch.search;
    }
    if (patch && patch.sort) s.sort = patch.sort;
    if (patch && patch.clearFilters) s.filters = {};
    /* A deliberate navigation leaves a collection focus behind unless the
       caller asked for one; otherwise "Library" in the rail would keep
       silently showing a subset. */
    s.focusCollection = patch && patch.collection ? patch.collection : null;

    /* Watch is a place you leave. Remember where from, so Exit goes back. */
    if (workspace === "watch" && s.workspace !== "watch") {
      s.prefs.lastWorkspace = s.workspace;
      root.XBStore.savePrefs(s.prefs);
    }

    closeSearch();
    s.selection.clear();
    if (root.XBLibraryView) root.XBLibraryView.resetPaging();
    St.set({ workspace }, "force");
  }

  function openCollection(id) {
    const s = St.state;
    s.focusCollection = id;
    s.filters = {};
    s.search = "";
    if (els.input) els.input.value = "";
    if (root.XBLibraryView) root.XBLibraryView.resetPaging();
    St.set({ workspace: "library" }, "force");
  }

  function openItem(item, list, viewerState) {
    /* Opening something Discover surfaced marks it engaged — a normal cooldown
       and a small quality signal, instead of being treated as ignored. */
    St.markEngaged(item.id);
    const items = list && list.length ? list : St.derived.items;
    const index = Math.max(0, items.findIndex((i) => i.id === item.id));
    if (viewerState) St.state.viewerState = viewerState;
    root.XBUI.transition(() => {
      root.XBViewer.open(items, index, { onClose: () => repaint() });
    });
  }

  /**
   * A save that didn't land. Silence here is the worst outcome: the session
   * keeps working from memory and the user only discovers the loss on reload,
   * so say it plainly and point at the exit (export).
   */
  let storageErrorShown = false;
  function onStorageError(event) {
    if (storageErrorShown) return;
    storageErrorShown = true;
    setTimeout(() => { storageErrorShown = false; }, 30000);
    const quota = event && event.detail && event.detail.quota;
    toast(quota
      ? "Storage is full — changes are only kept for this session. Export a backup, then delete items you don't need."
      : "Couldn't save to browser storage — changes are only kept for this session.", {
      error: true,
      action: "Export backup",
      onAction: () => go("manage"),
    });
  }

  function toast(message, opts) {
    if (snackbar) snackbar.show(message, opts);
  }

  /* --------------------------------------------------------------- dialogs -- */
  function surface(titleText, contentNode, actions, opts) {
    const o = opts || {};
    const scrim = h(".m3e-scrim", { "data-open": "false" });
    const dialog = h(".m3e-dialog", {
      role: "dialog", "aria-modal": "true", "data-open": "false", "aria-hidden": "true",
    });
    const title = h("h2.m3e-dialog__title", { text: titleText });
    dialog.appendChild(h(".m3e-dialog__header", title));
    dialog.appendChild(h(".m3e-dialog__content", contentNode));
    const foot = h(".m3e-dialog__actions");
    dialog.appendChild(foot);

    document.body.appendChild(scrim);
    document.body.appendChild(dialog);

    const overlay = root.M3E.createOverlay({
      element: dialog,
      scrim,
      onClose: () => setTimeout(() => { dialog.remove(); scrim.remove(); }, 240),
    });

    actions.forEach((spec) => {
      const b = h("button.ctl." + (spec.primary ? "ctl--accent" : "ctl--bordered"), {
        type: "button", text: spec.label,
      });
      if (spec.danger) { b.classList.remove("ctl--accent"); b.style.background = "var(--danger)"; b.style.color = "#fff"; b.style.borderColor = "transparent"; }
      b.addEventListener("click", () => {
        if (spec.on && spec.on() === false) return;
        overlay.close();
      });
      foot.appendChild(b);
    });

    overlay.open();
    if (o.focus) requestAnimationFrame(() => o.focus(dialog));
    return overlay;
  }

  function confirmDialog(opts) {
    surface(opts.title || "Are you sure?",
      h("p.t-body", { text: opts.body || "" }),
      [
        { label: opts.cancel || "Cancel" },
        { label: opts.confirm || "Confirm", primary: !opts.danger, danger: !!opts.danger, on: opts.onConfirm },
      ]);
  }

  function promptSaveView() {
    const s = St.state;
    const n = St.activeFilterCount();
    const input = h("input", { type: "text", maxlength: "60", spellcheck: "false", placeholder: "Portrait videos" });
    const body = h("div",
      h("p.dim.t-body-s", {
        style: { margin: "0 0 12px" },
        text: "Saves the current search, " + n + (n === 1 ? " filter" : " filters") + " and sort order. Reopen it any time from Views.",
      }),
      h("label.field", h("span", { text: "Name" }), input)
    );

    surface("Save this view", body, [
      { label: "Cancel" },
      {
        label: "Save view", primary: true,
        on: () => {
          const name = input.value.trim();
          if (!name) { input.focus(); return false; }
          const views = (s.prefs.savedViews || []).slice();
          views.unshift({
            id: "v" + Date.now(),
            name,
            search: s.search,
            sort: s.sort,
            filters: Object.assign({}, s.filters),
          });
          St.setPrefs({ savedViews: views.slice(0, 24) });
          toast('Saved "' + name + '"');
        },
      },
    ], { focus: () => input.focus() });
  }

  function manageViews() {
    const list = h(".mrows");
    const build = () => {
      clear(list);
      const views = St.state.prefs.savedViews || [];
      if (!views.length) {
        list.appendChild(h("p.dim.t-body", { text: "No saved views yet." }));
        return;
      }
      views.forEach((v) => {
        const count = Object.keys(v.filters || {}).length;
        const del = button("iconctl", {
          icon: "trash", iconSize: 16, aria: "Delete " + v.name,
          on: () => {
            St.setPrefs({ savedViews: (St.state.prefs.savedViews || []).filter((x) => x.id !== v.id) });
            build();
          },
        });
        del.style.color = "var(--danger)";
        list.appendChild(h(".mrow",
          h("div",
            h("b", { text: v.name }),
            h("small", { text: (v.search ? '"' + v.search + '" · ' : "") + count + (count === 1 ? " filter" : " filters") })
          ),
          del
        ));
      });
    };
    build();
    surface("Saved views", list, [{ label: "Done", primary: true }]);
  }

  /* --------------------------------------------------------------- data io -- */
  function importPrompt() {
    const input = h("input", { type: "file", accept: ".json,.jsonl,application/json", hidden: true });
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) root.XBManage.importFile(file, app);
      input.remove();
    });
    input.click();
  }

  function exportItems(items) {
    if (!items || !items.length) { toast("Nothing to export"); return; }
    const wanted = new Set(items.map((i) => i.post && i.post.tweet_id));
    const posts = St.state.bookmarks.filter((p) => wanted.has(p.tweet_id));
    const payload = {
      export_version: 2,
      exported_at: new Date().toISOString(),
      format: "x-library",
      bookmarks: posts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "x-selection.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Exported " + num(posts.length) + (posts.length === 1 ? " post" : " posts"));
  }

  function loadSample() {
    if (!root.XB_DEMO || !root.XB_DEMO.bookmarks || !root.XB_DEMO.bookmarks.length) {
      toast("No sample library — paste your posts into js/demo.js or import a file", { error: true });
      return;
    }
    St.replaceBookmarks(root.XB_DEMO.bookmarks.slice());
    go("discover");
    toast("Sample library loaded — import your own any time");
  }

  /* ==========================================================================
     Public surface
     ========================================================================== */
  const app = {
    boot,
    go,
    openCollection,
    openItem,
    repaint,
    toast,
    confirm: confirmDialog,
    promptSaveView,
    manageViews,
    importPrompt,
    exportItems,
    loadSample,
    get theme() { return theme; },
  };

  root.XBApp = app;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
