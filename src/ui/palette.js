/* =============================================================================
   palette v3 — one command surface for everything.

   Fuzzy over three groups: commands, creators, items. Subsequence scoring
   with bonuses for word starts and runs, so "morg" finds Morrigan and "vk"
   finds a username, without ever returning confident nonsense.
   ========================================================================== */

import { h, icon, pushEsc, trapFocus } from "./dom.js";
import { state, setQuery, setPrefs } from "../core/state.js";
import { results, post as postOf } from "../core/query.js";
import { navigate, toggleTheme, showShortcuts } from "../shell.js";
import { caption, thumbImg, avatar, fmtCount } from "./media.js";
import { openSettings } from "../views/settings.js";
import { openManage } from "../views/manage.js";

let open = null;

export function openPalette(initial = "") {
  if (open) return;

  const input = h("input", {
    type: "text", placeholder: "Search posts, creators, or run a command…",
    "aria-label": "Command palette", autocomplete: "off", spellcheck: "false", value: initial,
  });
  const list = h("div.pal__list", { role: "listbox", "aria-label": "Results" });
  const box = h("div.pal__box",
    h("div.pal__in", icon("search", 19), input, h("kbd.kbd", { text: "esc" })),
    list,
    h("div.pal__foot",
      h("span", {}, h("kbd.kbd", { text: "↑↓" }), " move"),
      h("span", {}, h("kbd.kbd", { text: "↵" }), " open"),
      h("span", {}, h("kbd.kbd", { text: "esc" }), " close"),
    ),
  );
  const root = h("div.pal", box);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add("is-in"));

  let groups = [];
  let flat = [];
  let sel = 0;
  const releaseEsc = pushEsc(close);
  const releaseTrap = trapFocus(box, input);

  function close() {
    if (root.dataset.closing) return;
    root.dataset.closing = "1";
    releaseEsc();
    releaseTrap();
    root.classList.remove("is-in");
    setTimeout(() => root.remove(), 160);
    open = null;
  }
  open = close;

  root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });

  /* ------------------------------------------------------------- search -- */

  const COMMANDS = [
    { label: "Go to Home", hint: "Dashboard", icon: "gauge", run: () => navigate("home") },
    { label: "Go to Library", hint: "The whole archive", icon: "grid", run: () => navigate("library") },
    { label: "Go to Watch", hint: "Immersive feed", icon: "play", run: () => navigate("watch") },
    { label: "Show unopened", hint: "Library filter", icon: "spark", run: () => { setQuery({ unseen: true, search: "", starred: false }); navigate("library"); } },
    { label: "Show starred", hint: "Library filter", icon: "star", run: () => { setQuery({ starred: true, search: "", unseen: false }); navigate("library"); } },
    { label: "Shuffle the library", hint: "Random order", icon: "shuffle", run: () => { import("../core/query.js").then((m) => m.reshuffle()); setQuery({ sort: "random" }); navigate("library"); } },
    { label: "Toggle theme", hint: "Dark ↔ light", icon: "sun", run: () => toggleTheme() },
    { label: "Blur media", hint: "Privacy blur on/off", icon: "eyeOff", run: () => setPrefs({ blurMedia: !state.prefs.blurMedia }) },
    { label: "Surprise me", hint: "One random item", icon: "spark", run: () => {
      const l = state.index.media; if (l.length) import("../viewer.js").then(({ openViewer }) => openViewer([l[Math.floor(Math.random() * l.length)]], 0));
    } },
    { label: "Settings", hint: "Appearance, media, privacy", icon: "settings", run: () => openSettings() },
    { label: "Import & export", hint: "Move data in and out", icon: "database", run: () => openManage() },
    { label: "Keyboard shortcuts", hint: "The whole list", icon: "keyboard", run: () => showShortcuts() },
  ];

  function score(needle, hay) {
    if (!needle) return 1;
    const n = needle.toLowerCase(), hs = hay.toLowerCase();
    const direct = hs.indexOf(n);
    if (direct >= 0) return 1000 - direct + (direct === 0 ? 200 : 0);
    let i = 0, s = 0, run = 0;
    for (let j = 0; j < hs.length && i < n.length; j++) {
      if (hs[j] === n[i]) {
        s += 4 + run * 3 + (/[\s@._-]/.test(hs[j - 1] || " ") ? 8 : 0);
        run++; i++;
      } else run = 0;
    }
    return i === n.length ? s : -1;
  }

  function highlight(text, needle) {
    const el = h("b");
    if (!needle) { el.textContent = text; return el; }
    const n = needle.toLowerCase(), t = text.toLowerCase();
    const at = t.indexOf(n);
    if (at >= 0) {
      el.append(text.slice(0, at), h("mark", { text: text.slice(at, at + n.length) }), text.slice(at + n.length));
      return el;
    }
    el.textContent = text;
    return el;
  }

  function compute() {
    const q = input.value.trim();
    groups = [];
    flat = [];

    const cmds = COMMANDS
      .map((cmd) => ({ cmd, s: score(q, `${cmd.label} ${cmd.hint}`) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 5 : 6);
    if (cmds.length) {
      groups.push({ group: "Commands", rows: cmds.map(({ cmd }) => addRow({
        render: () => h("button.pal__item", { type: "button" },
          h("span.row__icon.hue", { style: { "--hue": "var(--hue-b)" } }, icon(cmd.icon, 17)),
          h("span.pal__txt", highlight(cmd.label, q), h("small", { text: cmd.hint })),
        ),
        run: cmd.run,
      })) });
    }

    if (q) {
      const creators = state.index.authors
        .map((a) => ({ a, s: score(q, `${a.name} @${a.username}`) }))
        .filter((x) => x.s >= 0)
        .sort((x, y) => y.s - x.s)
        .slice(0, 4);
      if (creators.length) {
        groups.push({ group: "Creators", rows: creators.map(({ a }) => addRow({
          render: () => h("button.pal__item", { type: "button" },
            avatar(a.avatar, 28, a.name),
            h("span.pal__txt", highlight(a.name || a.username, q), h("small", { text: `@${a.username} · ${a.count} items` })),
            h("span.pal__hint", { text: fmtCount(a.count) }),
          ),
          run: () => { setQuery({ author: a.username, search: "", unseen: false, starred: false }); navigate("library"); },
        })) });
      }

      const pool = state.query.author || state.query.kind !== "all" ? results() : state.index.media;
      const found = [];
      for (const item of pool) {
        if (found.length >= 40) break;
        const p = postOf(item);
        const s = score(q, p.haystack || "");
        if (s >= 0) found.push({ item, p, s });
      }
      found.sort((a, b) => b.s - a.s);
      if (found.length) {
        groups.push({ group: `Items · ${found.length} match${found.length === 1 ? "" : "es"}`, rows: found.slice(0, 8).map(({ item, p }, i) => addRow({
          render: () => h("button.pal__item", { type: "button" },
            h("span.thumb", thumbImg(item, p, { sizes: "34px" })),
            h("span.pal__txt", highlight(caption(p, 70) || `@${p.author_username}`, q), h("small", { text: `@${p.author_username} · ${item.kind}` })),
          ),
          run: () => import("../viewer.js").then(({ openViewer }) => openViewer(found.map((f) => f.item), i)),
        })) });
      }
    }

    sel = 0;
    paintList(q);
  }

  function addRow(row) { flat.push(row); return row; }

  function paintList(q) {
    list.replaceChildren();
    for (const group of groups) {
      list.append(h("div.pal__group", h("span.t-label", { text: group.group })));
      for (const row of group.rows) {
        const el = row.render();
        el.addEventListener("click", () => { close(); row.run(); });
        el.addEventListener("pointermove", () => { const i = flat.indexOf(row); if (i !== sel) { sel = i; mark(); } });
        list.append(el);
      }
    }
    if (!flat.length) {
      list.append(h("div.empty", { style: { padding: "32px 16px" } },
        h("div.empty__icon", icon("search", 22)),
        h("h2", { text: q ? "No matches" : "Type to search" }),
        h("p", { text: q ? "Try a creator name, a word from the post, or a command." : "Commands, creators and every item in the archive." }),
      ));
    }
    mark();
  }

  function mark() {
    const els = list.querySelectorAll(".pal__item");
    els.forEach((el, i) => el.classList.toggle("is-sel", i === sel));
    els[sel]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", compute);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, flat.length - 1); mark(); }
    if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
    if (e.key === "Enter") { e.preventDefault(); const row = flat[sel]; if (row) { close(); row.run(); } }
  });

  compute();
}

export function closePalette() { open?.(); }
