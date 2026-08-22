/* =============================================================================
   Library — the power tool

   Three controls, three deliberate interaction patterns:

     View    → a nested menu (Layout / Size / Group) — or a bottom sheet on
               compact windows
     Filter  → an inline panel and chips, multi-select with OR within a group
               and AND across groups
     Random  → the DEFAULT ordering: a stable, session-scoped random sequence
               (Balanced by default). Deterministic Sort lives in the overflow.

   On compact windows each control opens a bottom sheet with large tap targets.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc, num, button } = root.XBUI;
  const St = root.XBState;

  const PAGE = 48;
  let shown = PAGE;
  let lastKey = "";

  const KINDS = [
    { id: "", label: "All" },
    { id: "photo", label: "Photos" },
    { id: "video", label: "Videos" },
    { id: "gif", label: "GIFs" },
  ];

  const GROUPS = [
    { id: "none", label: "No grouping" },
    { id: "date", label: "By date captured" },
    { id: "creator", label: "By creator" },
    { id: "type", label: "By media type" },
  ];

  /* ------------------------------------------------------------- rendering -- */
  function render(mount, app) {
    const s = St.state;
    const items = resultSet();

    /* Reset paging when the result set identity changes. */
    const key = s.search + "|" + s.sort + "|" + JSON.stringify(s.filters) + "|" + (s.focusCollection || "");
    if (key !== lastKey) { shown = PAGE; lastKey = key; }

    /* An empty archive is not an empty result set. Showing filter controls over
       nothing is a puzzle; show the way in instead. */
    if (!St.derived.all.length) {
      mount.appendChild(emptyArchive(app));
      return;
    }

    const page = h(".lib");
    page.appendChild(bar(items, app));
    page.appendChild(chips(app));
    page.appendChild(filterPanel(app));

    if (!items.length) {
      page.appendChild(noResults(app));
      mount.appendChild(page);
      return;
    }

    const visible = items.slice(0, shown);
    if (s.groupBy && s.groupBy !== "none") {
      root.XBLibrary.groupItems(visible, s.groupBy).forEach((group) => {
        const section = h(".group",
          h(".group__head", h("h3", { text: group.label }), h("span", { text: num(group.items.length) })),
          gridOf(group.items, app)
        );
        page.appendChild(section);
      });
    } else {
      page.appendChild(gridOf(visible, app));
    }

    if (items.length > shown) page.appendChild(more(items, app, page));
    mount.appendChild(page);
  }

  /**
   * Everything Library shows. A focused collection narrows the universe first;
   * search, filters and sort then apply on top, so "Top picks + only videos"
   * behaves the way anyone would expect.
   */
  function resultSet() {
    const id = St.state.focusCollection;
    if (!id) return St.derived.items;
    const col = St.derived.collection(id);
    if (!col) return St.derived.items;
    const allowed = new Set(col.items.map((i) => i.id));
    return St.derived.items.filter((i) => allowed.has(i.id));
  }

  function gridOf(items, app) {
    const s = St.state;
    const grid = h(".grid", { "data-layout": s.layout, "data-size": s.size });
    items.forEach((item) => {
      grid.appendChild(root.XBCard.card(item, {
        size: s.size === "large" ? "medium" : "small",
        fixed: s.layout === "grid",
        selected: s.selection.has(item.id),
        onOpen: () => app.openItem(item, resultSet()),
        onPick: (it) => St.toggleSelection(it.id),
      }));
    });
    return grid;
  }

  /* Explicit "Load more" plus an observer that trips slightly earlier — the
     button is the contract, the observer is the courtesy. */
  function more(items, app, page) {
    const btn = h("button.ctl.ctl--bordered", {
      type: "button",
      text: "Load " + num(Math.min(PAGE, items.length - shown)) + " more · " + num(items.length - shown) + " remaining",
    });
    const wrap = h(".grid__more", btn);
    const sentinel = h(".grid__sentinel");

    const load = () => { shown += PAGE; app.repaint(); };
    btn.addEventListener("click", load);

    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
      }, { rootMargin: "800px" });
      requestAnimationFrame(() => { if (sentinel.isConnected) io.observe(sentinel); });
    }
    page.appendChild(sentinel);
    return wrap;
  }

  /* ------------------------------------------------------------ level one -- */
  /* Three controls, three patterns — never the same shape twice:
       View    → a nested menu (Layout / Size / Group)
       Filter  → an inline panel (multi-select, AND/OR)
       Random  → the default ordering; a nested menu (Reshuffle + mode)
     Deterministic Sort lives behind the overflow menu. */
  function bar(items, app) {
    const s = St.state;
    const total = St.derived.all.length;
    const filtered = items.length !== total;

    const count = h(".libbar__count");
    count.appendChild(h("b", { text: num(items.length) }));
    count.appendChild(document.createTextNode(items.length === 1 ? " item" : " items"));
    if (filtered) count.appendChild(h("span", { text: "of " + num(total) }));

    /* Type is a multi-select toggle group: OR within (Photo OR Video), AND
       across the other filters. "All" is the empty state. */
    const kinds = h(".seg.libbar__kinds", { role: "group", "aria-label": "Media type" });
    KINDS.forEach((k) => {
      const on = k.id ? St.filterHas("kind", k.id) : !valueList(s.filters.kind).length;
      const b = h("button.seg__item", { type: "button", "aria-pressed": String(on), text: k.label });
      b.addEventListener("click", () => {
        if (!k.id) St.setFilter("kind", null);
        else St.toggleFilter("kind", k.id);
      });
      kinds.appendChild(b);
    });

    const right = h(".libbar__right");
    const fn = St.activeFilterCount();

    const filterBtn = h("button.ctl" + (fn ? ".ctl--on" : ""), {
      type: "button",
      "aria-expanded": String(s.filtersOpen),
      html: icon("filter", 16) + "<span>Filter</span>" + (fn ? '<span class="ctl__badge">' + fn + "</span>" : ""),
    });
    filterBtn.addEventListener("click", () => openFilter(app));

    const viewBtn = h("button.ctl", {
      type: "button", html: icon("view", 16) + "<span>View</span>",
    });
    viewBtn.addEventListener("click", () => openView(viewBtn, app));

    /* Random is the DEFAULT ordering — a stable random sequence (Balanced by
       default). Highlighted while it's active; selecting a deterministic Sort
       from the overflow dims it again. */
    const shuffleBtn = h("button.ctl" + (s.sort === "shuffle" ? ".ctl--on" : ""), {
      type: "button",
      "aria-label": "Random order",
      html: icon("sort", 16) + "<span>Random</span>",
    });
    shuffleBtn.addEventListener("click", () => openShuffle(shuffleBtn, app));

    /* Deterministic Sort gets its own control again: grouped Time / Activity /
       Engagement / Duration, as an anchored menu on desktop and a bottom
       sheet on compact windows. */
    const sorting = s.sort !== "shuffle";
    const sortBtn = h("button.ctl" + (sorting ? ".ctl--on" : ""), {
      type: "button",
      "aria-label": "Sort",
      "data-lib-sort": "",
      html: icon("sort", 16) + "<span>" + (sorting ? sortLabel(s.sort) : "Sort") + "</span>",
    });
    sortBtn.addEventListener("click", () => openSort(sortBtn, app));

    const moreBtn = h("button.iconctl", {
      type: "button", "aria-label": "More library actions", html: icon("more", 18),
    });
    moreBtn.addEventListener("click", () => overflowMenu(moreBtn, app));

    right.append(viewBtn, filterBtn, shuffleBtn, sortBtn, moreBtn);
    return h(".libbar", count, kinds, right);
  }

  function valueList(v) {
    if (Array.isArray(v)) return v;
    return v == null || v === "" || v === false ? [] : [v];
  }

  /* Compact windows (phone/tablet) get bottom sheets; expanded windows get
     anchored menus. The threshold matches the libbar wrap breakpoint so a
     sheet is used exactly when the toolbar stops fitting on one line. */
  function isCompact() {
    return typeof matchMedia === "function" && matchMedia("(max-width: 899px)").matches;
  }

  function openView(trigger, app) {
    if (isCompact()) viewSheet(app);
    else viewMenu(trigger, app);
  }

  function openShuffle(trigger, app) {
    if (isCompact()) shuffleSheet(app);
    else shuffleMenu(trigger, app);
  }

  function openSort(trigger, app) {
    if (isCompact()) sortSheet();
    else sortMenu(trigger, app);
  }

  /* On compact windows Filter is a full-height sheet rather than the inline
     panel, which is cramped on a phone. */
  function openFilter(app) {
    if (isCompact()) filterSheet(app);
    else St.set({ filtersOpen: !St.state.filtersOpen }, "force");
  }

  /* A bottom sheet built on the shared M3 sheet primitive. Content is product-
     voiced (pills / segmented) so it matches the rest of the toolbar. */
  function sheet(title, contentNode, opts) {
    const o = opts || {};
    const scrim = h(".m3e-scrim", { "data-open": "false" });
    const el = h(".m3e-sheet.m3e-sheet--bottom", {
      role: "dialog", "aria-modal": "true", "aria-label": title,
      "data-open": "false", "aria-hidden": "true", tabindex: "-1",
    });
    el.appendChild(h(".m3e-sheet__handle"));
    const header = h(".m3e-sheet__header",
      h(".m3e-sheet__title.t-title", { text: title }));
    if (o.action) {
      const btn = h("button.ctl.ctl--accent", { type: "button", text: o.action });
      btn.addEventListener("click", () => { if (o.onAction) o.onAction(); overlay.close(); });
      header.appendChild(btn);
    } else if (o.done !== false) {
      const done = h("button.ctl", { type: "button", text: "Done" });
      done.addEventListener("click", () => overlay.close());
      header.appendChild(done);
    }
    el.appendChild(header);
    const content = h(".m3e-sheet__content");
    content.appendChild(contentNode);
    el.appendChild(content);
    document.body.appendChild(scrim);
    document.body.appendChild(el);
    if (root.M3E && root.M3E.bindRipple) root.M3E.bindRipple(el);
    const overlay = root.M3E.createOverlay({
      element: el, scrim,
      onClose: () => setTimeout(() => { el.remove(); scrim.remove(); }, 260),
    });
    overlay.open();
    return overlay;
  }

  /* A labelled group of toggle pills, shared by the View, Shuffle and Filter
     sheets. Each group syncs its own pressed state in place after a click, so a
     sheet never needs to rebuild to reflect a selection. `multi` enables
     OR-within-group selection. */
  function pillGroup(label, pairs, currentFn, onPick, opts) {
    const o = opts || {};
    const block = h(".sheet__block");
    block.appendChild(h(".sheet__label", { text: label }));
    const row = h(".sheet__opts");
    const sync = () => {
      const cur = o.multi ? (currentFn() || []) : currentFn();
      Array.from(row.children).forEach((btn, i) => {
        const v = pairs[i][0];
        btn.setAttribute("aria-pressed", String(o.multi ? cur.indexOf(v) >= 0 : cur === v));
      });
    };
    pairs.forEach((pair) => {
      const value = pair[0], text = pair[1];
      const b = h("button.pill", { type: "button", text });
      b.addEventListener("click", () => { onPick(value); sync(); });
      row.appendChild(b);
    });
    sync();
    block.appendChild(row);
    return block;
  }

  function sortLabel(id) {
    if (id === "shuffle") return "Random";
    const s = St.SORTS.find((x) => x.id === id);
    return s ? s.label : "Sort";
  }

  /* --- mobile bottom sheets --------------------------------------------------
     Compact windows replace the anchored menus with full-width bottom sheets:
     larger tap targets, a Done action in the header, room to breathe. The data
     is identical to the desktop menus; only the presentation changes. Each pill
     syncs itself in place, so the sheet reflects a selection without rebuilding. */
  function viewSheet(app) {
    const s = St.state;
    const content = h(".sheet__body");
    content.appendChild(pillGroup("Layout",
      [["natural", "Masonry"], ["grid", "Grid"]], () => s.layout,
      (v) => St.set({ layout: v })));
    content.appendChild(pillGroup("Size",
      [["compact", "Compact"], ["comfortable", "Comfortable"], ["large", "Large"]], () => s.size,
      (v) => St.set({ size: v })));
    content.appendChild(pillGroup("Group",
      GROUPS.map((g) => [g.id, g.label]), () => s.groupBy,
      (v) => St.set({ groupBy: v })));
    sheet("View", content);
  }

  /* Sort — every deterministic ordering, grouped the same way as the desktop
     menu (Time / Activity / Engagement / Duration). Selecting Random is not
     offered here; it has its own control. Pills sync in place. */
  function sortSheet() {
    const groups = [];
    St.SORTS.forEach((s) => {
      let g = groups.find((x) => x.label === s.group);
      if (!g) { g = { label: s.group, pairs: [] }; groups.push(g); }
      g.pairs.push([s.id, s.label]);
    });
    const content = h(".sheet__body");
    groups.forEach((g) => {
      content.appendChild(pillGroup(g.label, g.pairs,
        () => (St.state.sort === "shuffle" ? "" : St.state.sort),
        (v) => { St.set({ sort: v }); }));
    });
    sheet("Sort", content);
  }

  function shuffleSheet(app) {    const s = St.state;
    const content = h(".sheet__body");
    const now = h("button.ctl.ctl--accent.sheet__primary", {
      type: "button", html: icon("refresh", 16) + "<span>Reshuffle</span>",
    });
    now.addEventListener("click", () => { St.shuffle(); });
    content.appendChild(now);
    content.appendChild(pillGroup("Mode",
      St.SHUFFLE_STRATEGIES.map((o) => [o.id, o.label]), () => s.shuffleStrategy,
      (v) => St.shuffle({ strategy: v })));
    content.appendChild(h(".sheet__hint", {
      text: s.shuffleStrategy === "balanced"
        ? "Varied creators, posts and media types."
        : "No logic, just chance.",
    }));
    sheet("Random", content, { done: false });
  }

  function filterSheet(app) {
    const content = h(".sheet__body");
    content.appendChild(sheetBlock("Type", options("kind", [
      ["photo", "Photos"], ["video", "Videos"], ["gif", "GIFs"],
    ], true)));
    content.appendChild(sheetBlock("Status", [
      options("seen", [["unseen", "Unseen"], ["viewed", "Seen"]]),
      options("progress", [["yes", "In progress"], ["no", "Not started"]]),
      options("archive", [["archived", "Include archived"]]),
    ]));
    content.appendChild(sheetBlock("Shape", options("shape", [
      ["portrait", "Portrait"], ["square", "Square"], ["wide", "Wide"],
    ], true)));
    content.appendChild(sheetBlock("Captured", [
      quickCaptured(),
      h(".filters__pair", dateField("From", "capturedFrom"), dateField("To", "capturedTo")),
    ]));
    content.appendChild(sheetBlock("Advanced", [
      authorField(),
      h(".filters__pair", numberField("Min seconds", "durationMin"), numberField("Max seconds", "durationMax")),
      options("alt", [["yes", "Has alt text"], ["no", "No alt text"]]),
      options("playable", [["no", "Unavailable only"]]),
    ]));
    sheet("Filters", content, { action: "Reset", onAction: () => St.clearFilters() });
  }

  function sheetBlock(label, content) {
    return h(".sheet__block", h(".sheet__label", { text: label }), content);
  }

  /* Quick relative-date chips for the Captured group: Today / 7 days / 30 days
     / Any. Sets a capturedFrom floor; "Any" clears it. */
  function quickCaptured() {
    const DAY = 86400000;
    const presets = [["today", "Today", 1], ["7d", "7 days", 7], ["30d", "30 days", 30]];
    const box = h(".filters__opts");
    const dateFor = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
    const isActive = (days) => St.state.filters.capturedFrom === dateFor(days);
    const sync = () => {
      Array.from(box.children).forEach((btn, i) => {
        if (i < presets.length) btn.setAttribute("aria-pressed", String(isActive(presets[i][2])));
        else btn.setAttribute("aria-pressed", String(!St.state.filters.capturedFrom));
      });
    };
    presets.forEach((p) => {
      const days = p[2];
      const b = h("button.pill", { type: "button", text: p[1] });
      b.addEventListener("click", () => { St.setFilter("capturedFrom", isActive(days) ? null : dateFor(days)); sync(); });
      box.appendChild(b);
    });
    const any = h("button.pill", { type: "button", text: "Any" });
    any.addEventListener("click", () => { St.setFilter("capturedFrom", null); St.setFilter("capturedTo", null); sync(); });
    box.appendChild(any);
    sync();
    return box;
  }

  /* ---------------------------------------------------------------- menus -- */
  function menu(trigger, build, opts) {
    const el = h(".m3e-menu", { role: "menu" });
    build(el, () => handle && handle.close());
    document.body.appendChild(el);
    const handle = root.M3E.openMenu(trigger, el, Object.assign({
      onClose: () => el.remove(),
    }, opts || {}));
    return handle;
  }

  function menuItem(label, opts) {
    const o = opts || {};
    const it = h("button.m3e-menu__item" + (o.danger ? ".m3e-menu__item--danger" : ""), {
      type: "button", role: "menuitem",
    });
    it.insertAdjacentHTML("beforeend", icon(o.icon || (o.selected ? "check" : "chevronRight"), 16));
    if (!o.icon && !o.selected) it.firstElementChild.style.visibility = "hidden";
    it.appendChild(h("span", { text: label }));
    if (o.selected) it.setAttribute("aria-selected", "true");
    if (o.on) it.addEventListener("click", o.on);
    return it;
  }

  function sortMenu(trigger, app) {
    menu(trigger, (el, close) => {
      let group = "";
      St.SORTS.forEach((s) => {
        if (s.group !== group) {
          group = s.group;
          el.appendChild(h(".m3e-menu__label", { text: group }));
        }
        el.appendChild(menuItem(s.label, {
          selected: St.state.sort === s.id,
          icon: St.state.sort === s.id ? "check" : null,
          on: () => { close(); St.set({ sort: s.id }); },
        }));
      });
    });
  }

  function viewMenu(trigger, app) {
    const s = St.state;
    menu(trigger, (el, close) => {
      el.appendChild(h(".m3e-menu__label", { text: "Layout" }));
      [["natural", "Masonry — true proportions"], ["grid", "Grid — uniform squares"]].forEach(([id, label]) => {
        el.appendChild(menuItem(label, {
          selected: s.layout === id,
          icon: s.layout === id ? "check" : null,
          on: () => { close(); St.set({ layout: id }); },
        }));
      });
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".m3e-menu__label", { text: "Size" }));
      [["compact", "Compact"], ["comfortable", "Comfortable"], ["large", "Large"]].forEach(([id, label]) => {
        el.appendChild(menuItem(label, {
          selected: s.size === id,
          icon: s.size === id ? "check" : null,
          on: () => { close(); St.set({ size: id }); },
        }));
      });
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".m3e-menu__label", { text: "Group" }));
      GROUPS.forEach((g) => {
        el.appendChild(menuItem(g.label, {
          selected: s.groupBy === g.id,
          icon: s.groupBy === g.id ? "check" : null,
          on: () => { close(); St.set({ groupBy: g.id }); },
        }));
      });
    });
  }

  /* Random is the default Library ordering. The menu offers Reshuffle (a new
     stable random order for this session) and the mode: Balanced (the smart
     mode — varied creators, posts and media types) or Pure random. Filters are
     always preserved. */
  function shuffleMenu(trigger, app) {
    const s = St.state;
    menu(trigger, (el, close) => {
      el.appendChild(menuAction("Reshuffle", icon("refresh", 16), () => {
        close();
        St.shuffle();
        app.toast("New random order");
      }));
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".m3e-menu__label", { text: "Mode" }));
      St.SHUFFLE_STRATEGIES.forEach((opt) => {
        el.appendChild(menuItem(opt.label, {
          selected: s.shuffleStrategy === opt.id,
          icon: s.shuffleStrategy === opt.id ? "check" : null,
          on: () => { close(); St.shuffle({ strategy: opt.id }); },
        }));
      });
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".menu__hint", {
        text: s.shuffleStrategy === "balanced"
          ? "Varied creators, posts and media types. Stable until you reshuffle."
          : "No logic, just chance. Stable until you reshuffle.",
      }));
    });
  }

  /* An action menu item: bold, leading icon, no checkmark — for verbs that do
     something (Reshuffle) rather than set a preference. */
  function menuAction(label, iconHtml, on) {
    const it = h("button.m3e-menu__item.m3e-menu__item--action", { type: "button", role: "menuitem" });
    it.insertAdjacentHTML("beforeend", iconHtml);
    it.appendChild(h("span", { text: label }));
    it.addEventListener("click", on);
    return it;
  }

  function overflowMenu(trigger, app) {
    const views = St.state.prefs.savedViews || [];
    menu(trigger, (el, close) => {
      el.appendChild(menuItem(
        St.state.sort === "shuffle" ? "Random order" : ("Sort by: " + sortLabel(St.state.sort)),
        { icon: "sort", on: () => { close(); openSort(trigger, app); } }
      ));
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(h(".m3e-menu__label", { text: "Views" }));
      if (!views.length) el.appendChild(h(".menu__hint", { text: "Save the current search, filters and sort as a reusable view." }));
      views.forEach((v) => {
        el.appendChild(menuItem(v.name, {
          icon: "mark",
          on: () => { close(); applyView(v); },
        }));
      });
      el.appendChild(menuItem("Save current view…", {
        icon: "plus",
        on: () => { close(); app.promptSaveView(); },
      }));
      if (views.length) {
        el.appendChild(menuItem("Manage saved views…", {
          icon: "settings", on: () => { close(); app.manageViews(); },
        }));
      }
      el.appendChild(h("hr.m3e-menu__divider"));
      el.appendChild(menuItem("Select all results", {
        icon: "check", on: () => { close(); St.selectAll(resultSet().map((i) => i.id)); },
      }));
      el.appendChild(menuItem("Export these results", {
        icon: "download", on: () => { close(); app.exportItems(resultSet()); },
      }));
      el.appendChild(menuItem("Library management", {
        icon: "manage", on: () => { close(); app.go("manage"); },
      }));
    });
  }

  function applyView(v) {
    St.state.filters = Object.assign({}, v.filters || {});
    St.set({ search: v.search || "", sort: v.sort || "newest_posted" }, "force");
  }

  /* --------------------------------------------------------- active chips -- */
  function chips(app) {
    const s = St.state;
    const box = h(".chips");
    const entries = Object.entries(s.filters).filter(([, v]) => v != null && v !== "" && v !== false);

    if (s.focusCollection) {
      const col = St.derived.collection(s.focusCollection);
      box.appendChild(chip(col ? col.title : s.focusCollection, () => {
        St.state.focusCollection = null;
        St.set({}, "force");
      }, "star"));
    }

    /* Each value in a group becomes its own chip so a multi-select (Photo OR
       Video) can drop one value without clearing the group. */
    entries.forEach(([key, value]) => {
      const vals = Array.isArray(value) ? value : [value];
      vals.forEach((v) => {
        box.appendChild(chip(chipLabel(key, v), () => {
          if (Array.isArray(s.filters[key]) && s.filters[key].length > 1) St.toggleFilter(key, v);
          else St.setFilter(key, null);
        }));
      });
    });

    if (St.activeFilterCount() > 1) {
      const clear = h("button.ctl", { type: "button", text: "Clear all" });
      clear.addEventListener("click", () => St.clearFilters());
      box.appendChild(clear);
    }
    return box;
  }

  function chip(label, onRemove, iconName) {
    const el = h("button.pill.is-on", {
      type: "button",
      "aria-label": "Remove filter: " + label,
      html: (iconName ? icon(iconName, 12) : "") + "<span>" + esc(label) + "</span>" +
        '<span class="pill__x">' + icon("close", 12) + "</span>",
    });
    el.addEventListener("click", onRemove);
    return el;
  }

  const CHIP_NAMES = {
    kind: { photo: "Photos", video: "Videos", gif: "GIFs" },
    shape: { portrait: "Portrait", square: "Square", wide: "Wide" },
    seen: { unseen: "Unseen", viewed: "Seen" },
    alt: { yes: "Has alt text", no: "No alt text" },
    playable: { yes: "Playable", no: "Unavailable" },
    progress: { yes: "In progress", no: "Not started" },
    archive: { archived: "Archived" },
  };

  function chipLabel(key, value) {
    if (CHIP_NAMES[key] && CHIP_NAMES[key][value]) return CHIP_NAMES[key][value];
    if (key === "author") return "@" + value;
    if (key === "postedFrom") return "Posted after " + value;
    if (key === "postedTo") return "Posted before " + value;
    if (key === "capturedFrom") return "Captured after " + value;
    if (key === "capturedTo") return "Captured before " + value;
    if (key === "durationMin") return "Longer than " + value + "s";
    if (key === "durationMax") return "Shorter than " + value + "s";
    return key + ": " + value;
  }

  /* ------------------------------------------------------------ level two -- */
  function filterPanel(app) {
    const s = St.state;
    const panel = h(".filters", { hidden: !s.filtersOpen, id: "filterPanel" });
    if (!s.filtersOpen) return panel;

    const grid = h(".filters__grid");
    grid.appendChild(block("Type", options("kind", [
      ["photo", "Photos"], ["video", "Videos"], ["gif", "GIFs"],
    ], true)));
    grid.appendChild(block("Status", [
      options("seen", [["unseen", "Unseen"], ["viewed", "Seen"]]),
      options("archive", [["archived", "Include archived"]]),
      options("progress", [["yes", "In progress"], ["no", "Not started"]]),
    ]));
    grid.appendChild(block("Shape", options("shape", [
      ["portrait", "Portrait"], ["square", "Square"], ["wide", "Wide"],
    ], true)));
    grid.appendChild(block("Captured", [
      h(".filters__pair",
        dateField("From", "capturedFrom"),
        dateField("To", "capturedTo")
      ),
    ]));
    grid.appendChild(block("Posted", [
      h(".filters__pair",
        dateField("From", "postedFrom"),
        dateField("To", "postedTo")
      ),
    ]));
    grid.appendChild(block("Advanced", [
      authorField(),
      h(".filters__pair",
        numberField("Min seconds", "durationMin"),
        numberField("Max seconds", "durationMax")
      ),
      options("alt", [["yes", "Has alt text"], ["no", "No alt text"]]),
      options("playable", [["no", "Unavailable only"]]),
    ]));
    panel.appendChild(grid);

    const clear = h("button.ctl", { type: "button", text: "Clear filters" });
    clear.addEventListener("click", () => St.clearFilters());
    const save = h("button.ctl.ctl--bordered", { type: "button", text: "Save as view" });
    save.addEventListener("click", () => app.promptSaveView());
    const done = h("button.ctl.ctl--accent", { type: "button", text: "Done" });
    done.addEventListener("click", () => St.set({ filtersOpen: false }, "force"));

    panel.appendChild(h(".filters__foot",
      h("span.dim", { text: num(resultSet().length) + " matching" }),
      h("span.spacer"), clear, save, done
    ));
    return panel;
  }

  function block(title, content) {
    return h(".filters__block", h("h4", { text: title }), content);
  }

  function options(key, pairs, multi) {
    const box = h(".filters__opts");
    const sync = () => {
      Array.from(box.children).forEach((btn, i) => {
        const v = pairs[i][0];
        const on = multi ? St.filterHas(key, v) : St.state.filters[key] === v;
        btn.setAttribute("aria-pressed", String(on));
      });
    };
    pairs.forEach(([value, label]) => {
      const b = h("button.pill", { type: "button", text: label });
      b.addEventListener("click", () => {
        if (multi) St.toggleFilter(key, value);
        else St.setFilter(key, St.state.filters[key] === value ? null : value);
        sync();
      });
      box.appendChild(b);
    });
    sync();
    return box;
  }

  function dateField(label, key) {
    const input = h("input", { type: "date", value: St.state.filters[key] || "" });
    input.addEventListener("change", () => St.setFilter(key, input.value || null));
    return h("label.field", h("span", { text: label }), input);
  }

  function numberField(label, key) {
    const input = h("input", { type: "number", min: "0", step: "1", value: St.state.filters[key] || "" });
    input.addEventListener("change", () => St.setFilter(key, input.value || null));
    return h("label.field", h("span", { text: label }), input);
  }

  function authorField() {
    const list = h("datalist", { id: "authorList" });
    St.derived.authors.slice(0, 200).forEach((a) => {
      const handle = typeof a === "string" ? a : a.author || a.handle;
      if (handle) list.appendChild(h("option", { value: handle }));
    });
    const input = h("input", {
      type: "text", list: "authorList", placeholder: "any creator",
      value: St.state.filters.author || "",
    });
    input.addEventListener("change", () => St.setFilter("author", input.value.replace(/^@/, "") || null));
    return h("label.field", h("span", { text: "Creator" }), input, list);
  }

  /* ----------------------------------------------------------- empty archive -- */
  function emptyArchive(app) {
    const importBtn = h("button.ctl.ctl--accent", {
      type: "button", html: icon("upload", 16) + "<span>Import bookmarks</span>",
    });
    importBtn.addEventListener("click", () => app.importPrompt());

    const actions = h(".empty__actions", importBtn);

    // Sample library was removed — demo.js is now an empty paste file.
    // Only show the sample button if user actually pasted data into demo.js
    const hasDemo = typeof window !== "undefined" && window.XB_DEMO && Array.isArray(window.XB_DEMO.bookmarks) && window.XB_DEMO.bookmarks.length;
    if (hasDemo) {
      const sample = h("button.ctl.ctl--bordered", { type: "button", text: "Browse pasted library" });
      sample.addEventListener("click", () => app.loadSample());
      actions.appendChild(sample);
    }

    return h(".empty.empty--center",
      h(".empty__glyph", { html: icon("library", 24) }),
      h("h2", { text: "Your archive starts here" }),
      h("p", { text: "Once the extension captures your X bookmarks, every photo, video and GIF lands here — searchable, filterable and sortable. Paste JSON into js/demo.js or POSTS.json to see it without importing." }),
      actions
    );
  }

  /* ------------------------------------------------------------- no results -- */
  function noResults(app) {
    const s = St.state;
    const hasQuery = !!s.search || St.activeFilterCount() > 0;
    const actions = h(".empty__actions");
    if (hasQuery) {
      const clear = h("button.ctl.ctl--accent", { type: "button", text: "Clear search and filters" });
      clear.addEventListener("click", () => {
        St.state.filters = {};
        St.set({ search: "" }, "force");
      });
      actions.appendChild(clear);
    }
    const toDiscover = h("button.ctl.ctl--bordered", { type: "button", text: "Back to Discover" });
    toDiscover.addEventListener("click", () => app.go("discover"));
    actions.appendChild(toDiscover);

    return h(".empty.empty--center",
      h(".empty__glyph", { html: icon("search", 24) }),
      h("h2", { text: hasQuery ? "Nothing matches" : "Nothing here yet" }),
      h("p", { text: hasQuery
        ? "Try a broader search, or loosen one of the active filters. Archived items are hidden unless you ask for them."
        : "Capture some bookmarks with the extension and they'll show up here." }),
      actions
    );
  }

  root.XBLibraryView = { render, resultSet, resetPaging() { shown = PAGE; } };
})(window);
