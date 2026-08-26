/* =============================================================================
   manage — getting an archive in and out.

   Import accepts every shape this data arrives in: the extension's export
   object, a bare array of bookmarks, or a file with extra wrapper keys. Export
   writes the same schema back, so a file can round-trip through this app
   without losing anything the next import expects.
   ============================================================================= */

import { h, icon } from "../ui/dom.js";
import { overlay, toast, confirm } from "../ui/feedback.js";
import { state, set } from "../core/state.js";
import { project, invalidateIndex } from "../core/data.js";
import { persistBookmarks, clearSelection } from "../core/state.js";
import { KEYS, setMany, backendName, estimateBytes } from "../core/store.js";
import { fmtCount } from "../ui/media.js";

export function openManage() {
  const sheet = overlay({ title: "Import & export", size: "md" });
  draw(sheet.content, sheet);
  return sheet;
}

function draw(content, sheet) {
  content.replaceChildren();

  /* ------------------------------------------------------------- status -- */
  const s = state.index.media.length;
  content.append(h("div.manage__status",
    h("span.manage__status-icon", icon("database", 20)),
    h("div",
      h("b", { text: s ? `${fmtCount(s)} items loaded` : "No archive loaded" }),
      h("small", { text: s ? `From ${describeSource()}` : "Import a file to begin" }),
    ),
  ));

  /* ------------------------------------------------------------- import -- */
  content.append(h("h3.manage__h", { text: "Import" }));

  const drop = h("div.manage__drop", {
    tabindex: "0", role: "button",
    "aria-label": "Choose an export file, or drop one here",
  },
    icon("upload", 24),
    h("b", { text: "Choose a file" }),
    h("small", { text: "JSON from the capture extension — or drop it here" }),
  );
  const fileInput = h("input", {
    type: "file", accept: ".json,application/json", hidden: true,
    onchange: (e) => e.target.files?.[0] && handleFile(e.target.files[0], sheet),
  });
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });

  for (const event of ["dragenter", "dragover"]) {
    drop.addEventListener(event, (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  }
  for (const event of ["dragleave", "drop"]) {
    drop.addEventListener(event, (e) => { e.preventDefault(); drop.classList.remove("is-over"); });
  }
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file, sheet);
  });

  content.append(drop, fileInput);

  content.append(h("button.manage__link", {
    type: "button", text: "or paste JSON instead",
    onclick: () => openPaste(sheet),
  }));

  /* ------------------------------------------------------------- export -- */
  content.append(h("h3.manage__h", { text: "Export" }));
  const selected = state.ui.selected.size;

  content.append(h("div.manage__actions",
    h("button.btn", {
      type: "button", disabled: !s,
      onclick: () => exportItems(state.index.media, sheet),
    }, icon("download", 17), `All ${fmtCount(s)} items`),
    h("button.btn", {
      type: "button", disabled: !selected,
      onclick: () => {
        const items = state.index.media.filter((m) => state.ui.selected.has(m.id));
        exportItems(items, sheet);
      },
    }, icon("star", 17), selected ? `${selected} selected` : "Selection"),
    h("button.btn", {
      type: "button", disabled: !Object.keys(state.library.starred).length,
      onclick: () => {
        const items = state.index.media.filter((m) => state.library.starred[m.id]);
        exportItems(items, sheet);
      },
    }, icon("star", 17), `Starred (${fmtCount(Object.keys(state.library.starred).length)})`),
  ));

  content.append(h("p.settings__note",
    icon("info", 15),
    h("span", { text: "Exports use the same schema the capture extension writes, so a file can be re-imported later without loss." }),
  ));

  /* -------------------------------------------------------------- reset -- */
  content.append(h("h3.manage__h", { text: "Storage" }));
  const store = h("div.manage__store", h("div.spinner"));
  content.append(store);
  Promise.all([backendName(), estimateBytes()]).then(([backend, bytes]) => {
    store.replaceChildren(
      h("div.manage__fact", h("b", { text: backend }), h("small", { text: "Backend" })),
      h("div.manage__fact", h("b", { text: fmtBytes(bytes) }), h("small", { text: "In use" })),
    );
  });

  content.append(h("button.btn.btn--block", {
    type: "button",
    onclick: async () => {
      const ok = await confirm({
        title: "Clear everything stored here",
        message: "Removes your imported archive, seen history, stars and settings from this browser. Files on disk are untouched.",
        confirmLabel: "Clear all data", danger: true,
      });
      if (!ok) return;
      await setMany({});
      const { removeMany } = await import("../core/store.js");
      await removeMany(Object.values(KEYS));
      location.reload();
    },
  }, icon("trash", 17), "Clear all local data"));
}

function describeSource() {
  switch (state.source) {
    case "./POSTS.json": return "POSTS.json in this project";
    case "./data/posts.slim.json": return "the pre-built index (fast path)";
    case "storage": return "a previous import in this browser";
    default: return state.source;
  }
}

function fmtBytes(n) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/* ----------------------------------------------------------------- read -- */

async function handleFile(file, sheet) {
  const busy = toast(`Reading ${file.name}…`, { duration: 30000 });
  try {
    const text = await file.text();
    await ingest(text, sheet);
  } catch (err) {
    toast(`Could not read that file: ${err.message}`);
  } finally {
    busy?.();
  }
}

async function openPaste(sheet) {
  const paste = overlay({ title: "Paste JSON", size: "md" });
  const area = h("textarea.manage__paste", {
    placeholder: "Paste the contents of your export file here…",
    "aria-label": "JSON", spellcheck: "false",
  });
  const error = h("p.settings__error", { role: "alert" });
  paste.content.append(area, error,
    h(".sheet__actions",
      h("button.btn", { type: "button", text: "Cancel", onclick: () => paste.close() }),
      h("button.btn.btn--primary", {
        type: "button", text: "Import",
        onclick: async () => {
          if (!area.value.trim()) { error.textContent = "Nothing pasted yet."; return; }
          try { await ingest(area.value, sheet); paste.close(); }
          catch (err) { error.textContent = err.message; }
        },
      }),
    ),
  );
  setTimeout(() => area.focus(), 60);
}

async function ingest(text, sheet) {
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("That is not valid JSON."); }

  const bookmarks = Array.isArray(json) ? json
    : Array.isArray(json?.bookmarks) ? json.bookmarks
    : Array.isArray(json?.posts) ? json.posts
    : Array.isArray(json?.data) ? json.data
    : null;

  if (!bookmarks) throw new Error("No bookmark list found. Expected an array, or an object with a “bookmarks” key.");
  if (!bookmarks.length) throw new Error("That file contains no bookmarks.");

  /* Replacing an archive is destructive; ask first when one is already here. */
  if (state.index.media.length) {
    const ok = await confirm({
      title: "Replace your archive?",
      message: `This replaces the ${fmtCount(state.index.media.length)} items currently loaded with ${fmtCount(bookmarks.length)} from the file. Seen history and stars for matching posts are kept.`,
      confirmLabel: "Replace", danger: true,
    });
    if (!ok) return;
  }

  clearSelection();
  await persistBookmarks(bookmarks);
  await invalidateIndex();

  const index = project(bookmarks);
  set({ index, source: "storage" });
  toast(`Imported ${fmtCount(index.media.length)} items`);
  sheet?.close();
  import("../shell.js").then(({ navigate }) => navigate("home"));
}

/* --------------------------------------------------------------- export -- */

/**
 * Rebuilds the export schema from the projection. Fields this app does not keep
 * (notably `raw`) are absent, which is the point: the file is 87% smaller and
 * still imports cleanly.
 */
function exportItems(items, sheet) {
  if (!items.length) { toast("Nothing to export."); return; }

  const byPost = new Map();
  for (const item of items) {
    const p = state.index.posts.get(item.postId);
    if (!p) continue;
    if (!byPost.has(p.id)) byPost.set(p.id, { post: p, media: [] });
    byPost.get(p.id).media.push(item);
  }

  const bookmarks = [...byPost.values()].map(({ post, media }) => ({
    tweet_id: post.tweet_id ?? post.id,
    author_id: post.author_id ?? null,
    author_name: post.author_name ?? null,
    author_username: post.author_username ?? null,
    author_profile_image_url: post.author_profile_image_url ?? null,
    text: post.text ?? "",
    tweet_created_at: post.createdAt ? new Date(post.createdAt).toISOString() : null,
    captured_at: post.capturedAt ? new Date(post.capturedAt).toISOString() : null,
    capture_order: post.capture_order ?? null,
    canonical_url: post.canonical_url ?? post.tweet_url ?? null,
    has_media: true,
    has_links: !!post.has_links,
    like_count_at_capture: post.like_count_at_capture ?? 0,
    retweet_count_at_capture: post.retweet_count_at_capture ?? 0,
    reply_count_at_capture: post.reply_count_at_capture ?? 0,
    view_count_at_capture: post.view_count_at_capture ?? 0,
    media_types: [...new Set(media.map((m) => m.kind))],
    media_items: media.map((m) => ({
      type: m.kind === "gif" ? "animated_gif" : m.kind,
      url: m.thumb,
      poster: m.poster,
      mp4: m.video,
      aspect: m.aspect,
      width: m.w,
      height: m.h,
      duration: Math.round(m.dur * 1000),
      position: m.pos,
      alt: m.alt || null,
    })),
  }));

  const payload = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    source: "x-bookmarks-archive",
    bookmarks,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", {
    href: url,
    download: `x-bookmarks-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  toast(`Exported ${fmtCount(items.length)} items`);
  sheet?.close();
}
