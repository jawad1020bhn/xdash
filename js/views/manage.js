/* =============================================================================
   Library management

   Import, export, storage and maintenance. Split out of Settings on purpose:
   preferences are reversible, data operations are not, and mixing the two in
   one scrolling modal is how people delete things by accident.
   ============================================================================= */
(function (root) {
  "use strict";

  const { h, icon, num, bytes, dateLong } = root.XBUI;
  const St = root.XBState;

  let usage = null;

  function render(mount, app) {
    const page = h(".manage");
    const stats = St.derived.stats;

    /* The page heading is the shell's — see XBApp.withHead. */
    page.appendChild(storage(stats, app));

    const cards = h(".mcards");
    cards.appendChild(importCard(app));
    cards.appendChild(exportCard(app));
    page.appendChild(h("section",
      h("h2.t-headline", { text: "Import & export" }),
      h("p.dim.t-body-s", { style: { margin: "4px 0 14px" }, text: "Exports are plain JSON. A backup additionally carries your viewing history, progress and preferences." }),
      cards
    ));

    page.appendChild(maintenance(stats, app));
    mount.appendChild(page);

    /* Storage size needs an async round-trip; fill it in when it lands. */
    if (usage == null) {
      root.XBStore.estimateBytes().then((n) => {
        usage = n;
        const slot = page.querySelector("[data-usage]");
        if (slot) slot.textContent = bytes(n);
      });
    }
  }

  /* ---------------------------------------------------------------- meter -- */
  function storage(stats, app) {
    const posts = St.state.bookmarks.length;
    const lib = St.state.library;
    const tracked = Object.keys(lib.viewed).length + Object.keys(lib.archived).length + Object.keys(lib.progress).length;

    const parts = [
      { label: "Posts", value: posts, color: "var(--accent)" },
      { label: "Viewing history", value: tracked, color: "color-mix(in srgb, var(--accent) 45%, var(--surface-3))" },
      { label: "Failed captures", value: St.state.dead.length, color: "var(--danger)" },
    ];
    const total = parts.reduce((n, p) => n + p.value, 0) || 1;

    const bar = h(".meter__bar");
    parts.forEach((p) => {
      if (!p.value) return;
      bar.appendChild(h("i", { style: { width: (p.value / total) * 100 + "%", background: p.color } }));
    });

    const legend = h(".meter__legend");
    parts.forEach((p) => {
      legend.appendChild(h("span.meter__key", { style: { "--_c": p.color }, text: p.label + " · " + num(p.value) }));
    });

    return h(".meter",
      h(".meter__top",
        h("b", { "data-usage": "", text: usage == null ? "—" : bytes(usage) }),
        h("span.dim", { text: num(stats.media) + " media items · " + num(stats.posts) + " posts" })
      ),
      bar,
      legend,
      backendNote()
    );
  }

  /**
   * Where the bytes actually live. Outside the extension the dashboard writes
   * to IndexedDB — localStorage's ~5 MB ceiling is far too small for a real
   * library — and only falls back to localStorage when IndexedDB is blocked
   * (private windows, hardened settings), which is worth saying out loud.
   */
  function backendNote() {
    const note = h("p.dim.t-body-s", { text: root.XBStore.hasChrome()
      ? "Stored in this extension's local storage. Nothing leaves your machine."
      : "Stored in this browser, for this origin. Nothing leaves your machine." });
    if (!root.XBStore.hasChrome() && root.XBStore.backendName) {
      root.XBStore.backendName().then((name) => {
        note.textContent = name === "indexeddb"
          ? "Stored in this browser's IndexedDB for the current origin. Nothing leaves your machine."
          : "IndexedDB is unavailable here, so the library falls back to localStorage — roughly 5 MB, "
            + "after which saves fail. Serve the dashboard over http or allow site data to get the full store.";
      });
    }
    return note;
  }

  /* ------------------------------------------------------------- io cards -- */
  function card(iconName, title, description, actions) {
    return h(".mcard",
      h(".mcard__glyph", { html: icon(iconName, 18) }),
      h("h3", { text: title }),
      h("p", { text: description }),
      h(".mcard__actions", ...actions)
    );
  }

  function btn(label, on, cls) {
    const b = h("button.ctl" + (cls ? "." + cls : ".ctl--bordered"), { type: "button", text: label });
    b.addEventListener("click", on);
    return b;
  }

  function importCard(app) {
    const input = h("input", { type: "file", accept: ".json,.jsonl,application/json", hidden: true });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) importFile(file, app);
      input.value = "";
    });
    const pick = btn("Choose file…", () => input.click(), "ctl--accent");
    return h("div", card("upload", "Import",
      "Merge a previous export or a raw capture file. Posts already in your library are skipped, never duplicated.",
      [pick, btn("Load sample library", () => app.loadSample())]), input);
  }

  function exportCard(app) {
    return card("download", "Export",
      "Take everything with you. The library file is portable; the backup also restores your history on another machine.",
      [
        btn("Export library", () => exportData(false, app), "ctl--accent"),
        btn("Full backup", () => exportData(true, app)),
        btn("Export current results", () => app.exportItems(St.derived.items)),
      ]);
  }

  /* -------------------------------------------------------- maintenance -- */
  function maintenance(stats, app) {
    const rows = h(".mrows");

    rows.appendChild(mrow(
      "Unavailable media",
      num(stats.unavailable) + " items reference media that no longer loads.",
      "Review", () => {
        St.state.filters = { playable: "no" };
        app.go("library");
      }, !stats.unavailable));

    rows.appendChild(mrow(
      "Failed captures",
      St.state.dead.length
        ? num(St.state.dead.length) + " posts errored during capture and were set aside."
        : "No capture failures recorded.",
      "Open capture", () => app.go("capture"), !St.state.dead.length));

    rows.appendChild(mrow(
      "Viewing history",
      num(Object.keys(St.state.library.viewed).length) + " items marked seen · " +
      num(Object.keys(St.state.library.progress).length) + " with saved positions.",
      "Clear history", () => app.confirm({
        title: "Clear viewing history?",
        body: "Everything becomes unseen again and saved video positions are forgotten. Archived items and the media itself stay exactly as they are.",
        confirm: "Clear history",
        onConfirm: () => {
          St.state.library.viewed = {};
          St.state.library.progress = {};
          St.state.library.lastOpened = {};
          root.XBStore.saveLibrary(St.state.library);
          St.bump();
          St.notify("data");
          app.toast("Viewing history cleared");
        },
      })));

    rows.appendChild(mrow(
      "Archived items",
      num(Object.keys(St.state.library.archived).length) + " items are hidden from normal browsing.",
      "Show archived", () => {
        St.state.filters = { archive: "archived" };
        app.go("library");
      }));

    rows.appendChild(mrow(
      "Delete everything",
      "Remove every captured post, all history and all progress from this browser.",
      "Delete library", () => app.confirm({
        title: "Delete the entire library?",
        body: "This removes every captured post, your viewing history and all saved positions from this browser. Export a backup first if you might want any of it back. This cannot be undone.",
        confirm: "Delete everything",
        danger: true,
        onConfirm: async () => {
          St.state.library = { viewed: {}, archived: {}, progress: {}, lastOpened: {}, surfaced: {} };
          St.state.dead = [];
          await root.XBStore.saveBookmarks([]);
          await root.XBStore.saveLibrary(St.state.library);
          await root.XBStore.remove([root.XBStore.KEYS.dead]);
          St.replaceBookmarks([]);
          app.go("discover");
          app.toast("Library deleted");
        },
      }), false, true));

    return h("section",
      h("h2.t-headline", { text: "Maintenance" }),
      h("p.dim.t-body-s", { style: { margin: "4px 0 14px" }, text: "Housekeeping for the parts of an archive that decay." }),
      rows
    );
  }

  function mrow(title, description, action, on, disabled, danger) {
    const b = h("button.ctl" + (danger ? "" : ".ctl--bordered"), { type: "button", text: action });
    if (danger) b.style.color = "var(--danger)";
    if (disabled) b.disabled = true;
    b.addEventListener("click", on);
    return h(".mrow", h("div", h("b", { text: title }), h("small", { text: description })), b);
  }

  /* --------------------------------------------------------------- io --- */
  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportData(full, app) {
    const s = St.state;
    const payload = {
      export_version: 2,
      exported_at: new Date().toISOString(),
      format: full ? "x-library-backup" : "x-library",
      bookmarks: s.bookmarks,
    };
    if (full) {
      payload.library = s.library;
      payload.prefs = s.prefs;
      payload.dead_letters = s.dead;
      payload.capture = s.capture;
    }
    download(full ? "x-library-backup.json" : "x-library.json", JSON.stringify(payload, null, 2));
    app.toast(full ? "Backup downloaded" : "Library exported");
  }

  async function importFile(file, app) {
    let posts = [];
    let extra = null;
    try {
      const text = await file.text();
      if (file.name.endsWith(".jsonl") || (text.trim().startsWith("{") && text.includes("\n{"))) {
        posts = text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
      } else {
        const json = JSON.parse(text);
        if (Array.isArray(json)) posts = json;
        else if (Array.isArray(json.bookmarks)) { posts = json.bookmarks; extra = json; }
        else if (json.tweet_id) posts = [json];
      }
    } catch (err) {
      app.toast("Couldn't read that file — it isn't valid JSON", { error: true });
      return;
    }

    const map = new Map(St.state.bookmarks.map((b) => [b.tweet_id, b]));
    let added = 0;
    posts.forEach((p) => {
      if (!p || !p.tweet_id || map.has(p.tweet_id)) return;
      map.set(p.tweet_id, p);
      added++;
    });

    if (extra && extra.library) {
      St.state.library = Object.assign({}, St.state.library, extra.library);
      root.XBStore.saveLibrary(St.state.library);
    }
    St.replaceBookmarks(Array.from(map.values()));
    usage = null;
    app.toast(added ? "Merged " + num(added) + " new posts" : "Nothing new — everything was already here");
  }

  root.XBManage = { render, importFile, exportData };
})(window);
