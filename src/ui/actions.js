/* =============================================================================
   actions v3 — the per-item menu and the multi-select bar.
   ========================================================================== */

import { h, icon } from "./dom.js";
import { state, markStarred, markHidden, markArchived, clearSelection, toggleSelected } from "../core/state.js";
import { post } from "../core/query.js";
import { overlay, toast, confirmDialog } from "./feedback.js";
import { setQuery } from "../core/state.js";
import { navigate } from "../shell.js";

/* ---------------------------------------------------------- item menu ----- */

export function itemActions(item) {
  const p = post(item);
  const starred = state.library.starred[item.id];
  const sheet = overlay({ title: "Item actions", size: "sm" });

  const rows = [
    { icon: "expand", label: "Open in viewer", hint: item.kind === "photo" ? "Photo" : `${item.kind} · full screen`, hue: "var(--hue-b)",
      run: () => { sheet.close(); import("../viewer.js").then(({ openViewer }) => openViewer([item], 0)); } },
    { icon: starred ? "starFill" : "star", label: starred ? "Remove star" : "Star this item", hint: "Stars survive exports", hue: "var(--hue-e)",
      run: () => { const on = markStarred(item.id); sheet.close(); toast(on ? "Starred" : "Star removed"); } },
    { icon: "users", label: `More from @${p.author_username || "unknown"}`, hint: `${p.author_name || ""}`, hue: "var(--hue-c)",
      run: () => { sheet.close(); setQuery({ author: p.author_username, search: "", unseen: false, starred: false }); navigate("library"); } },
    { icon: "link", label: "Copy link", hint: p.canonical_url || p.tweet_url || "", hue: "var(--hue-f)",
      run: async () => {
        const url = p.canonical_url || p.tweet_url || "";
        try { await navigator.clipboard.writeText(url); toast("Link copied"); }
        catch { toast("Could not reach the clipboard"); }
        sheet.close();
      } },
    { icon: "external", label: "Open on X", hint: "Leaves this app", hue: "var(--hue-a)",
      run: () => { window.open(p.canonical_url || p.tweet_url, "_blank", "noopener"); sheet.close(); } },
    { icon: "eyeOff", label: state.library.hidden[item.id] ? "Unhide from library" : "Hide from library", hint: "Reversible from Settings", hue: "var(--hue-d)",
      run: () => { const on = markHidden(item.id); sheet.close(); toast(on ? "Hidden from your library" : "Back in your library"); } },
    { icon: "archive", label: state.library.archived[item.postId] ? "Restore this post" : "Archive this post", hint: "Removes every item in it", hue: "var(--hue-e)",
      run: async () => {
        const on = !state.library.archived[item.postId];
        if (on && !(await confirmDialog({ title: "Archive post?", message: "Every item from this post leaves your library. You can restore it any time.", confirmLabel: "Archive" }))) return;
        markArchived(item.postId, on);
        sheet.close();
        toast(on ? "Post archived" : "Post restored");
      } },
  ];

  for (const row of rows) {
    sheet.content.append(h("button.menu-row.hue", { type: "button", style: { "--hue": row.hue }, onclick: row.run },
      h("span.menu-row__icon", icon(row.icon, 18)),
      h("span.menu-row__text", h("b", { text: row.label }), h("small", { text: row.hint })),
      icon("chevronRight", 16),
    ));
  }
}

/* ------------------------------------------------------- selection bar ---- */

let barEl = null;

export function selectionBar() {
  return (onAction) => {
    const n = state.ui.selected.size;
    if (!state.ui.selecting || !n) { barEl?.remove(); barEl = null; return null; }

    if (!barEl) {
      barEl = h("div.selbar", { role: "toolbar", "aria-label": "Selection actions" });
      document.body.append(barEl);
    }
    barEl.replaceChildren(
      h("span.selbar__n", { text: String(n) }),
      h("button.icon-btn", { type: "button", "aria-label": "Star selected", onclick: () => onAction("star") }, icon("star", 19)),
      h("button.icon-btn", { type: "button", "aria-label": "Hide selected", onclick: () => onAction("hide") }, icon("eyeOff", 19)),
      h("button.icon-btn", { type: "button", "aria-label": "Archive selected posts", onclick: () => onAction("archive") }, icon("archive", 19)),
      h("button.icon-btn", { type: "button", "aria-label": "Clear selection", onclick: () => { clearSelection(); } }, icon("close", 19)),
    );
    return barEl;
  };
}

/** Bulk operations over the current selection. */
export async function runSelection(action) {
  const ids = [...state.ui.selected];
  if (!ids.length) return;

  if (action === "star") {
    for (const id of ids) markStarred(id, true);
    toast(`Starred ${ids.length} item${ids.length === 1 ? "" : "s"}`);
  }
  if (action === "hide") {
    for (const id of ids) markHidden(id, true);
    toast(`Hidden ${ids.length} item${ids.length === 1 ? "" : "s"}`);
  }
  if (action === "archive") {
    const postIds = new Set(ids.map((id) => id.split(":")[0]));
    if (!(await confirmDialog({
      title: `Archive ${postIds.size} post${postIds.size === 1 ? "" : "s"}?`,
      message: "They leave your library but stay in the export. Reversible any time.",
      confirmLabel: "Archive", danger: true,
    }))) return;
    for (const pid of postIds) markArchived(pid, true);
    toast(`Archived ${postIds.size} post${postIds.size === 1 ? "" : "s"}`);
  }
  if (action === "unselect") {
    for (const id of ids) toggleSelected(id);
  }
  clearSelection();
}
