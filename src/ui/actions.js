/* =============================================================================
   actions — what you can do to one item, and to a selection.

   One sheet for both, reachable three ways: long press, right click, or the
   bulk bar. The same verbs in the same order every time.
   ============================================================================= */

import { h, icon } from "./dom.js";
import { overlay, toast, confirm } from "./feedback.js";
import { state, markStarred, markHidden, markArchived, markViewed } from "../core/state.js";
import { post as postOf } from "../core/query.js";
import { avatar, fmtDuration, fmtCount } from "./media.js";
import { syncCards } from "./card.js";

export function openItemActions(item, list, index, anchor) {
  const p = postOf(item);
  const sheet = overlay({ title: null, size: "sm" });

  sheet.content.append(h("div.act-head",
    h("div.act-head__media", h("img", {
      src: item.thumb || item.poster || "", alt: "", loading: "lazy", decoding: "async",
      referrerpolicy: "no-referrer",
    })),
    h("div.act-head__text",
      h("b", { text: p.text ? p.text.slice(0, 120) : (item.kind === "photo" ? "Photo" : "Video") }),
      h("small", {},
        `@${p.author_username || "unknown"}`,
        item.dur ? ` · ${fmtDuration(item.dur)}` : "",
        p.like_count_at_capture ? ` · ${fmtCount(p.like_count_at_capture)} likes` : "",
      ),
    ),
  ));

  const starred = !!state.library.starred[item.id];
  const actions = [
    { icon: "play", label: "Open", run: () => { sheet.close(); import("../viewer.js").then((m) => m.openViewer(list, index)); } },
    { icon: starred ? "star" : "star", label: starred ? "Remove star" : "Star",
      run: () => { markStarred(item.id, !starred); sheet.close(); toast(starred ? "Star removed" : "Starred"); } },
    { icon: "user", label: `Everything by @${p.author_username || "unknown"}`,
      run: () => { sheet.close(); import("../core/state.js").then(({ setQuery }) => {
        setQuery({ author: p.author_username, search: "" });
        import("../shell.js").then(({ navigate }) => navigate("library"));
      }); } },
    { icon: "copy", label: "Copy link to post",
      run: async () => { await copy(p.canonical_url || p.tweet_url || ""); sheet.close(); toast("Link copied"); } },
    { icon: "external", label: "Open on X",
      run: () => { open(p.canonical_url || p.tweet_url, "_blank", "noopener"); sheet.close(); } },
    { icon: "download", label: item.kind === "photo" ? "Download image" : "Download video",
      run: () => { download(item); sheet.close(); } },
    { icon: "eye", label: state.library.viewed[item.id] ? "Mark as unseen" : "Mark as seen",
      run: () => { markViewed(item.id, !state.library.viewed[item.id]); sheet.close(); } },
    { icon: "eyeOff", label: "Hide from my library", danger: true,
      run: () => { markHidden(item.id, true); sheet.close(); toast("Hidden from your library"); } },
  ];

  for (const a of actions) {
    sheet.content.append(h(`button.menu-row${a.danger ? ".menu-row--danger" : ""}`, {
      type: "button", onclick: a.run,
    },
      h("span.menu-row__icon", icon(a.icon, 19)),
      h("span.menu-row__text", h("b", { text: a.label })),
    ));
  }
  return sheet;
}

/** The bar that appears across the bottom while a selection is active. */
export function selectionBar(host) {
  const bar = h("div.selbar", { role: "toolbar", "aria-label": "Selection actions" });

  function render() {
    const n = state.ui.selected.size;
    bar.hidden = n === 0;
    if (!n) return;
    bar.replaceChildren(
      h("span.selbar__count.t-num", { text: `${n} selected` }),
      h("div.selbar__actions",
        h("button.icon-btn", {
          type: "button", "aria-label": "Star selected", title: "Star",
          onclick: () => bulk((id) => markStarred(id, true), "Starred"),
        }, icon("star", 20)),
        h("button.icon-btn", {
          type: "button", "aria-label": "Mark selected as seen", title: "Mark seen",
          onclick: () => bulk((id) => markViewed(id, true), "Marked as seen"),
        }, icon("check", 20)),
        h("button.icon-btn", {
          type: "button", "aria-label": "Hide selected", title: "Hide",
          onclick: () => bulk((id) => markHidden(id, true), "Hidden"),
        }, icon("eyeOff", 20)),
        h("button.icon-btn", {
          type: "button", "aria-label": "Download selected", title: "Download",
          onclick: async () => {
            const items = state.index.media.filter((m) => state.ui.selected.has(m.id));
            for (const item of items.slice(0, 12)) { download(item); await sleep(350); }
            if (items.length > 12) toast("Downloading the first 12 — browsers throttle the rest.");
          },
        }, icon("download", 20)),
        h("button.btn.btn--sm", {
          type: "button", text: "Clear",
          onclick: () => import("../core/state.js").then(({ clearSelection }) => clearSelection()),
        }),
      ),
    );
  }

  function bulk(fn, message) {
    for (const id of state.ui.selected) fn(id);
    toast(`${message} ${state.ui.selected.size} items`);
    import("../core/state.js").then(({ clearSelection }) => clearSelection());
  }

  host.append(bar);
  return render;
}

async function bulkConfirm() {
  return confirm({
    title: "Apply to selection",
    message: "This changes every item you have selected. It can be undone from Settings.",
    confirmLabel: "Apply",
  });
}
void bulkConfirm;

/* ----------------------------------------------------------------- verbs -- */

async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* Clipboard API needs a secure context; fall back to the old way. */
    const ta = h("textarea", { style: { position: "fixed", opacity: "0" }, text });
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { /* nothing left to try */ }
    ta.remove();
  }
}

function download(item) {
  const url = item.kind === "photo" ? (item.full || item.thumb) : (item.video || item.full);
  if (!url) { toast("No downloadable file for this item."); return; }
  const a = h("a", { href: url, download: "", target: "_blank", rel: "noopener" });
  document.body.append(a);
  a.click();
  a.remove();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
void avatar;
