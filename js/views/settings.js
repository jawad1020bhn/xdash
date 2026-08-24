/* =============================================================================
   Settings — a page, not a modal

   Six groups, a sticky index down the left, and one row per decision. A modal
   was the wrong container: preferences are browsed, compared and revisited,
   and a dialog makes all three feel like an interruption.

   Data & storage is deliberately absent — it moved to Library management,
   because destroying data is not a preference.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, esc } = root.XBUI;
  const St = root.XBState;

  const GROUPS = [
    { id: "appearance", label: "Appearance", icon: "palette" },
    { id: "browsing", label: "Browsing", icon: "library" },
    { id: "playback", label: "Playback", icon: "play" },
    { id: "accessibility", label: "Accessibility", icon: "accessibility" },
    { id: "session", label: "Session", icon: "session" },
    { id: "shortcuts", label: "Shortcuts", icon: "keyboard" },
  ];

  function render(mount, app) {
    const page = h(".prefs");

    const index = h("nav.prefs__index", { "aria-label": "Settings sections" });
    GROUPS.forEach((g, i) => {
      const a = h("a", { href: "#pg-" + g.id, html: icon(g.icon, 16) + "<span>" + esc(g.label) + "</span>" });
      if (!i) a.setAttribute("aria-current", "true");
      index.appendChild(a);
    });

    const body = h(".prefs__body");
    body.appendChild(appearance(app));
    body.appendChild(browsing(app));
    body.appendChild(playback(app));
    body.appendChild(accessibility(app));
    body.appendChild(session(app));
    body.appendChild(shortcuts(app));

    page.appendChild(index);
    page.appendChild(body);
    mount.appendChild(page);

    /* Highlight the section you are actually looking at. */
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id.replace("pg-", "");
          index.querySelectorAll("a").forEach((a) => {
            a.toggleAttribute("aria-current", a.getAttribute("href") === "#pg-" + id);
            if (a.getAttribute("href") === "#pg-" + id) a.setAttribute("aria-current", "true");
          });
        });
      }, { rootMargin: "-30% 0px -60% 0px" });
      body.querySelectorAll(".pgroup").forEach((el) => io.observe(el));
    }
  }

  /* ------------------------------------------------------------- builders -- */
  function group(id, title, description, ...rows) {
    return h("section.pgroup", { id: "pg-" + id },
      h(".pgroup__head", h("h2", { text: title }), description ? h("p", { text: description }) : null),
      h(".pgroup__card", ...rows)
    );
  }

  function row(label, hint, control, stack) {
    return h(".prow" + (stack ? ".prow--stack" : ""),
      h(".prow__text", h("b", { text: label }), hint ? h("small", { text: hint }) : null),
      h(".prow__ctl", control)
    );
  }

  function toggle(prefKey, onChange) {
    const on = !!St.state.prefs[prefKey];
    const sw = h("button.sw", { type: "button", role: "switch", "aria-checked": String(on) });
    sw.addEventListener("click", () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(next));
      St.setPrefs({ [prefKey]: next });
      if (onChange) onChange(next);
    });
    return sw;
  }

  function segmented(value, pairs, onPick) {
    const seg = h(".seg", { role: "group" });
    pairs.forEach(([id, label]) => {
      const b = h("button.seg__item", { type: "button", "aria-pressed": String(value === id), text: label });
      b.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        onPick(id);
      });
      seg.appendChild(b);
    });
    return seg;
  }

  function select(value, pairs, onPick) {
    const sel = h("select");
    pairs.forEach(([id, label]) => {
      sel.appendChild(h("option", { value: id, text: label, selected: id === value }));
    });
    sel.addEventListener("change", () => onPick(sel.value));
    return h("label.field", sel);
  }

  /* ---------------------------------------------------------- appearance -- */
  function appearance(app) {
    const p = St.state.prefs;
    const theme = app.theme;

    const seeds = h(".seeds", { role: "group", "aria-label": "Accent colour" });
    root.M3ETheme.SEEDS.forEach((seed) => {
      const preview = root.M3ETheme.seedPreview(seed.hex, theme.settings);
      const on = (p.seed || root.M3ETheme.DEFAULTS.seed).toLowerCase() === seed.hex.toLowerCase();
      const b = h("button.seed", {
        type: "button", title: seed.name, "aria-label": seed.name,
        "aria-pressed": String(on),
        style: { "--_c": preview },
      });
      b.addEventListener("click", () => {
        St.setPrefs({ seed: seed.hex });
        theme.set({ seed: seed.hex });
        app.repaint();
      });
      seeds.appendChild(b);
    });

    return group("appearance", "Appearance", "How the archive looks. Changes apply immediately.",
      row("Theme", "Follow the system, or pin one.",
        segmented(p.themeScheme, [["system", "System"], ["light", "Light"], ["dark", "Dark"]], (v) => {
          St.setPrefs({ themeScheme: v });
          app.theme.set({ scheme: v });
        })),
      row("Accent colour", "Used for selection, progress, primary actions and focus.", seeds, true),
      row("Colour style", "How far the palette strays from the accent you picked.",
        select(p.variant, [
          ["vibrant", "Vibrant — true to the swatch"],
          ["tonalSpot", "Balanced"],
          ["expressive", "Expressive — playful hue shift"],
          ["neutral", "Neutral — nearly grey"],
        ], (v) => { St.setPrefs({ variant: v }); app.theme.set({ variant: v }); app.repaint(); })),
      row("Contrast", "Deepens text and rules for easier reading.",
        segmented(p.contrast, [["standard", "Standard"], ["medium", "Medium"], ["high", "High"]], (v) => {
          St.setPrefs({ contrast: v });
          app.theme.set({ contrast: v });
        })),
      row("Default view", "The size and arrangement new sessions start with.",
        h("div", { style: { display: "flex", gap: "6px" } },
          segmented(St.state.size, [["compact", "Compact"], ["comfortable", "Comfortable"], ["large", "Large"]],
            (v) => St.set({ size: v })),
          segmented(St.state.layout, [["natural", "Masonry"], ["grid", "Grid"]], (v) => St.set({ layout: v }))
        ), true)
    );
  }

  /* ------------------------------------------------------------ browsing -- */
  function browsing(app) {
    const p = St.state.prefs;
    return group("browsing", "Browsing", "What the grid shows and how it behaves.",
      row("Full captions", "Show the whole post text on hover instead of the first line.", toggle("fullCaptions", () => app.repaint())),
      row("Mark as seen on open", "Opening an item counts as having seen it.", toggle("markViewedOnOpen")),
      row("Hover previews", "Play a muted preview when you rest on a video or GIF.", toggle("autoplayPreviews")),
      row("Start on", "The workspace the dashboard opens with.",
        select(p.landing || "discover", [
          ["discover", "Discover"], ["library", "Library"], ["watch", "Watch"], ["last", "Wherever I left off"],
        ], (v) => St.setPrefs({ landing: v })))
    );
  }

  /* ------------------------------------------------------------ playback -- */
  function playback(app) {
    const p = St.state.prefs;
    return group("playback", "Playback", "Video and GIF behaviour in the viewer and in Watch.",
      row("Start muted", "Videos open with sound. Turn on to start silent instead.", toggle("alwaysMuted")),
      row("Remember position", "Resume long videos where you stopped.", toggle("rememberProgress")),
      row("Loop GIFs", "GIFs repeat until you move on.", toggle("loopGifs")),
      row("Loop videos", "Videos repeat instead of ending.", toggle("loopVideos")),
      row("Picture-in-picture", "Offer the PiP control where the browser supports it.", toggle("pip")),
      row("Default speed", "Applied to every video you open.",
        select(String(p.defaultSpeed || 1), [
          ["0.5", "0.5×"], ["0.75", "0.75×"], ["1", "Normal"], ["1.25", "1.25×"], ["1.5", "1.5×"], ["2", "2×"],
        ], (v) => St.setPrefs({ defaultSpeed: Number(v) })))
    );
  }

  /* ------------------------------------------------------- accessibility -- */
  function accessibility(app) {
    return group("accessibility", "Accessibility", "These settings also respect your operating system preferences.",
      row("Reduce motion", "Removes transitions, previews and view transitions.",
        toggle("reduceMotion", (v) => app.theme.set({ reducedMotion: v }))),
      row("Larger controls", "Bigger tap targets throughout.",
        toggle("largeControls", (v) => {
          document.documentElement.dataset.controls = v ? "large" : "normal";
        })),
      row("Always show alt text", "Display creator-written descriptions under media in the viewer.", toggle("alwaysAlt"))
    );
  }

  /* ------------------------------------------------------------- session -- */
  function session(app) {
    const restore = h("button.ctl.ctl--bordered", { type: "button", text: "Forget scroll positions" });
    restore.addEventListener("click", () => {
      St.setPrefs({ scrollPositions: {}, railScrolls: {}, lastItemId: null, lastScroll: 0 });
      app.toast("Session positions cleared");
    });

    const searches = h("button.ctl.ctl--bordered", { type: "button", text: "Clear recent searches" });
    searches.addEventListener("click", () => {
      St.setPrefs({ recentSearches: [] });
      app.toast("Recent searches cleared");
    });

    const reset = h("button.ctl.ctl--bordered", { type: "button", text: "Reset all settings" });
    reset.addEventListener("click", () => app.confirm({
      title: "Reset all settings?",
      body: "Every preference returns to its default. Your captured bookmarks, viewing history and progress are untouched.",
      confirm: "Reset settings",
      onConfirm: () => {
        const keep = {
          savedViews: St.state.prefs.savedViews,
          recentSearches: St.state.prefs.recentSearches,
        };
        St.state.prefs = Object.assign({}, root.XBStore.PREF_DEFAULTS, keep);
        root.XBStore.savePrefs(St.state.prefs);
        app.theme.set(root.M3ETheme.DEFAULTS);
        app.repaint();
        app.toast("Settings reset");
      },
    }));

    return group("session", "Session", "What the dashboard remembers between visits.",
      row("Restore where I was", "Return to the same workspace and scroll position.", toggle("restoreSession")),
      row("Scroll positions", "Stored per workspace so long scrolls survive a reload.", restore),
      row("Recent searches", (St.state.prefs.recentSearches || []).length + " stored", searches),
      row("Reset", "Return every preference on this page to its default.", reset)
    );
  }

  /* ----------------------------------------------------------- shortcuts -- */
  const KEYS = [
    ["/", "Focus search"],
    ["D", "Discover"],
    ["L", "Library"],
    ["W", "Watch"],
    ["F", "Toggle filters"],
    ["S", "Sort menu"],
    ["← →", "Previous / next in viewer"],
    ["Space", "Play or pause"],
    ["I", "Details pane"],
    ["C", "Focus mode"],
    ["O", "Open on X"],
    ["A", "Archive current item"],
    ["Esc", "Close viewer or panel"],
    ["?", "This list"],
  ];

  function shortcuts() {
    const table = h(".keys");
    KEYS.forEach(([key, label]) => {
      table.appendChild(h(".keyrow",
        h("span", { text: label }),
        h("kbd.k", { text: key })
      ));
    });
    return group("shortcuts", "Shortcuts", "Everything below works whenever a text field isn't focused.",
      h(".prow.prow--stack", table));
  }

  root.XBSettings = { render };
})(window);
