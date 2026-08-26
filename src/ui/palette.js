/* =============================================================================
   palette — one surface for search, creators and commands.

   The previous product spread this across four places: a search dropdown, a
   filter sheet, a "More" sheet, and two navigation destinations. Everything a
   person might want to jump to now lives behind one keystroke, and on a phone
   the same component is the sheet behind the search button.
   ============================================================================= */

import { h, icon, clear, nextFrame } from "./dom.js";
import { overlay } from "./feedback.js";
import { state, setQuery, set, markStarred } from "../core/state.js";
import { results, parseSearch, topAuthors, post as postOf, SORT_LABELS } from "../core/query.js";
import { thumb, avatar, fmtCount, fmtAgo } from "./media.js";
import { openViewer } from "../viewer.js";

const MAX_RESULTS = 40;
let active = null;

export function openPalette(initial = "") {
  if (active) { active.close(); return; }

  const sheet = overlay({ kind: "sheet", size: "full", title: null });
  active = sheet;
  sheet.el.classList.add("palette");

  const input = h("input.palette__input", {
    type: "search", placeholder: "Search posts, creators, or type a command",
    "aria-label": "Search your archive", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", value: initial, enterkeyhint: "go",
  });

  const field = h("div.palette__field",
    h("span.palette__field-icon", icon("search", 18)),
    input,
    h("button.icon-btn.palette__clear", {
      type: "button", "aria-label": "Clear search", hidden: true,
      onclick: () => { input.value = ""; render(); input.focus(); },
    }, icon("close", 18)),
  );

  const list = h("div.palette__list", { role: "listbox", "aria-label": "Results" });
  const footer = h("div.palette__footer");

  sheet.content.classList.add("palette__content");
  sheet.content.append(field, list, footer);

  let items = [];
  let cursor = 0;

  /* ------------------------------------------------------------ results -- */

  function commands(q) {
    const all = [
      { icon: "home", label: "Go to Home", run: () => go("home") },
      { icon: "grid", label: "Go to Library", run: () => go("library") },
      { icon: "play", label: "Start watching", run: () => go("watch") },
      { icon: "video", label: "Only videos", run: () => filter({ kind: "video" }) },
      { icon: "image", label: "Only photos", run: () => filter({ kind: "photo" }) },
      { icon: "eye", label: "Only things I haven't seen", run: () => filter({ unseen: true }) },
      { icon: "star", label: "Only starred", run: () => filter({ starred: true }) },
      { icon: "shuffle", label: "Shuffle my archive", run: () => filter({ sort: "random" }) },
      { icon: "clock", label: "Longest videos first", run: () => filter({ sort: "longest" }) },
      { icon: "heart", label: "Most liked first", run: () => filter({ sort: "liked" }) },
      { icon: "sun", label: `Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} theme`,
        run: () => { import("../core/state.js").then(({ setPrefs }) =>
          setPrefs({ themeMode: document.documentElement.dataset.theme === "dark" ? "light" : "dark" })); } },
      { icon: "database", label: "Import or export", run: () => import("../views/manage.js").then((m) => m.openManage()) },
      { icon: "settings", label: "Settings", run: () => import("../views/settings.js").then((m) => m.openSettings()) },
    ];
    if (!q) return all.slice(0, 5);
    return all.filter((c) => c.label.toLowerCase().includes(q));
  }

  function go(route) {
    sheet.close();
    import("../shell.js").then(({ navigate }) => navigate(route));
  }
  function filter(patch) {
    setQuery({ ...patch });
    sheet.close();
    import("../shell.js").then(({ navigate }) => navigate("library"));
  }

  function render() {
    const q = input.value.trim();
    const lower = q.toLowerCase();
    sheet.el.querySelector(".palette__clear").hidden = !q;
    items = [];
    cursor = 0;
    clear(list);

    /* --- posts --- */
    if (q) {
      const tokens = parseSearch(q);
      const hits = [];
      for (const item of state.index.media) {
        const p = postOf(item);
        if (!p.haystack) continue;
        if (tokens.every(({ term, negate }) => p.haystack.includes(term) !== negate)) {
          hits.push(item);
          if (hits.length >= MAX_RESULTS) break;
        }
      }
      if (hits.length) {
        list.append(section(`Posts · ${hits.length}${hits.length >= MAX_RESULTS ? "+" : ""}`));
        hits.forEach((item, i) => list.append(postRow(item, i)));
      }

      /* --- creators --- */
      const creators = state.index.authors
        .filter((a) => a.username.toLowerCase().includes(lower) ||
                       (a.name || "").toLowerCase().includes(lower))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      if (creators.length) {
        list.append(section("Creators"));
        creators.forEach((a) => list.append(creatorRow(a)));
      }
    } else {
      const recent = state.prefs.recentSearches?.slice(0, 5) || [];
      if (recent.length) {
        list.append(section("Recent"));
        for (const term of recent) {
          items.push({ el: null });
          list.append(h("button.pal-row", {
            role: "option", type: "button",
            onclick: () => { input.value = term; render(); input.focus(); },
          },
            h("span.pal-row__icon", icon("clock", 18)),
            h("span.pal-row__label", { text: term }),
          ));
        }
      }
      list.append(section("Jump to"));
    }

    /* --- commands --- */
    const cmds = commands(lower);
    if (cmds.length) {
      if (q) list.append(section("Actions"));
      cmds.forEach((c) => list.append(commandRow(c)));
    }

    if (!list.children.length) {
      list.append(h("div.palette__none",
        icon("search", 20),
        h("p", { text: `Nothing in your archive matches “${q}”.` }),
      ));
    }

    // Rebuild the flat selectable list from the DOM.
    items = [...list.querySelectorAll(".pal-row")];
    paintCursor();
    renderFooter();
  }

  function section(label) {
    return h("h3.palette__section", { text: label });
  }

  function postRow(item, i) {
    const p = postOf(item);
    const row = h("button.pal-row", {
      role: "option", type: "button", "aria-selected": "false",
      onclick: () => {
        remember(input.value.trim());
        sheet.close();
        openViewer(results().length ? results() : [item], Math.max(0, results().indexOf(item)), { fallback: [item] });
      },
    },
      h("span.pal-row__thumb", thumb(item, p, { sizes: "80px" })),
      h("span.pal-row__text",
        h("b", { text: p.text ? p.text.slice(0, 90) : (item.kind === "photo" ? "Photo" : "Video") }),
        h("small", {},
          `@${p.author_username || "unknown"}`,
          p.like_count_at_capture ? ` · ${fmtCount(p.like_count_at_capture)} likes` : "",
          p.capturedAt ? ` · ${fmtAgo(p.capturedAt)}` : "",
        ),
      ),
      h("button.pal-row__star", {
        type: "button",
        "aria-label": state.library.starred[item.id] ? "Remove star" : "Star this",
        "aria-pressed": state.library.starred[item.id] ? "true" : "false",
        onclick: (e) => {
          e.stopPropagation();
          const on = markStarred(item.id);
          e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
          e.currentTarget.setAttribute("aria-label", on ? "Remove star" : "Star this");
        },
      }, icon("star", 17)),
    );
    row.dataset.index = String(items.length);
    return row;
  }

  function creatorRow(a) {
    return h("button.pal-row", {
      role: "option", type: "button", "aria-selected": "false",
      onclick: () => {
        remember(a.username);
        sheet.close();
        setQuery({ author: a.username, search: "" });
        import("../shell.js").then(({ navigate }) => navigate("library"));
      },
    },
      h("span.pal-row__avatar", avatar(a.avatar, 40, a.name)),
      h("span.pal-row__text",
        h("b", { text: a.name }),
        h("small", { text: `@${a.username} · ${a.count} in your archive` }),
      ),
      icon("chevronRight", 18),
    );
  }

  function commandRow(c) {
    return h("button.pal-row", {
      role: "option", type: "button", "aria-selected": "false",
      onclick: () => c.run(),
    },
      h("span.pal-row__icon", icon(c.icon, 18)),
      h("span.pal-row__label", { text: c.label }),
    );
  }

  function renderFooter() {
    clear(footer);
    const total = state.index.media.length;
    footer.append(h("span", { text: q_count() }));
    footer.append(h("span.palette__keys",
      h("kbd.kbd", { text: "↑↓" }), " navigate",
      h("kbd.kbd", { text: "↵" }), " open",
      h("kbd.kbd", { text: "esc" }), " close",
    ));
    function q_count() {
      const n = items.length;
      return n ? `${n} result${n === 1 ? "" : "s"} of ${total} items` : `${total} items in your archive`;
    }
  }

  /* ------------------------------------------------------- interaction -- */

  function paintCursor() {
    items.forEach((el, i) => {
      const on = i === cursor;
      el.classList.toggle("is-cursor", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }

  function move(delta) {
    if (!items.length) return;
    cursor = (cursor + delta + items.length) % items.length;
    paintCursor();
  }

  function remember(term) {
    if (!term || term.length < 2) return;
    const recent = [term, ...(state.prefs.recentSearches || []).filter((t) => t !== term)].slice(0, 8);
    import("../core/state.js").then(({ setPrefs }) => setPrefs({ recentSearches: recent }));
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      items[cursor]?.click();
    }
  });
  list.addEventListener("pointermove", (e) => {
    const row = e.target.closest(".pal-row");
    if (!row) return;
    const i = items.indexOf(row);
    if (i >= 0 && i !== cursor) { cursor = i; paintCursor(); }
  });

  sheet.el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); sheet.close(); }
  });

  const origClose = sheet.close;
  sheet.close = () => { active = null; origClose(); };

  render();
  nextFrame().then(() => input.focus({ preventScroll: true }));
  return sheet;
}
