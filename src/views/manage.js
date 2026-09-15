/* =============================================================================
   manage v3 — import & export.

   Exports are written back in the capture extension's schema (minus the dead
   `raw` payload), so a file round-trips through this app and still opens in
   the extension.
   ========================================================================== */

import { h, icon } from "../ui/dom.js";
import { state } from "../core/state.js";
import { overlay, toast, confirmDialog } from "../ui/feedback.js";
import { persistBookmarks } from "../core/state.js";
import { invalidateIndex } from "../core/data.js";
import { backendName, estimateBytes } from "../core/store.js";
import { fmtBytes, fmtCount } from "../ui/media.js";
import { stats } from "../core/query.js";

export function openManage(firstRun = false) {
  const sheet = overlay({ title: firstRun ? "Welcome to your archive" : "Import & export" });
  const c = sheet.content;

  if (firstRun) {
    c.append(h("p.t-small", {
      style: { color: "var(--text-2)", padding: "2px 4px 0" },
      text: "This room is empty — it fills the moment you bring an export in. Drop your POSTS.json below; everything stays on this device.",
    }));
  }

  const status = h("div.row",
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-b)" } }, icon("database", 18)),
    h("span.row__text", h("b", { text: "Current archive" }), h("small", { text: "measuring…" })),
  );
  c.append(status);
  Promise.all([backendName(), estimateBytes()]).then(([backend, bytes]) => {
    const s = stats();
    status.querySelector("small").textContent =
      s.media ? `${fmtCount(s.media)} items · ${fmtBytes(bytes)} in ${backend} · source: ${state.source}` : `empty · ${backend}`;
  }).catch(() => {});

  c.append(h("div.sheet__group", h("span.t-label", { text: "Bring data in" })));
  const dz = h("div.dropzone", {
    role: "button", tabindex: "0",
    "aria-label": "Import an export file: drop it here or press Enter to browse",
  },
    h("span.dropzone__icon", icon("upload", 22)),
    h("b", { text: "Drop your export here" }),
    h("small", { text: "POSTS.json — an array, or {bookmarks: []}" }),
  );
  dz.addEventListener("click", () => pickFile(sheet));
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickFile(sheet); }
  });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("is-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("is-over"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("is-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) importFile(file, sheet);
  });
  c.append(dz);

  c.append(h("div.sheet__group", h("span.t-label", { text: "Take data out" })));
  c.append(h("button.row", {
    type: "button",
    onclick: () => download(sheet),
  },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-c)" } }, icon("download", 18)),
    h("span.row__text",
      h("b", { text: "Export this archive" }),
      h("small", { text: "Same schema as the extension, minus the unused raw payload" }),
    ),
    icon("chevronRight", 16),
  ));

  c.append(h("div.sheet__group", h("span.t-label", { text: "Danger zone" })));
  c.append(h("button.row", {
    type: "button",
    onclick: async () => {
      if (!(await confirmDialog({
        title: "Forget this device's copy?",
        message: "Removes the stored archive, your stars, seen history and the index cache from this browser. The POSTS.json file on disk is untouched.",
        confirmLabel: "Forget everything", danger: true,
      }))) return;
      const { removeMany, KEYS } = await import("../core/store.js");
      await removeMany(Object.values(KEYS));
      location.reload();
    },
  },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-a)" } }, icon("trash", 18)),
    h("span.row__text",
      h("b", { text: "Forget this device's copy" }),
      h("small", { text: "Archive, stars, seen history and cache" }),
    ),
    icon("chevronRight", 16),
  ));
}

/* ---------------------------------------------------------------- import -- */

function pickFile(sheet) {
  const input = h("input", { type: "file", accept: "application/json,.json", class: "sr" });
  document.body.append(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (file) importFile(file, sheet);
  });
  input.click();
}

/* One intake for the picker and the dropzone. */
async function importFile(file, sheet) {
  if (file.size > 200 * 1024 * 1024) {
    toast("That file is over 200 MB — the browser cannot safely hold it.", { duration: 7000 });
    return;
  }
  try {
    const json = JSON.parse(await file.text());
    const bookmarks = Array.isArray(json) ? json : json.bookmarks || json.posts || json.data;
    if (!Array.isArray(bookmarks) || !bookmarks.length) throw new Error("No bookmarks array found in that file");
    await persistBookmarks(bookmarks);
    await invalidateIndex();
    sheet.close();
    toast(`Imported ${bookmarks.length} bookmarks — reloading`, { duration: 2500 });
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    toast(`Could not read that file: ${err.message}`, { duration: 7000 });
  }
}

/* ---------------------------------------------------------------- export -- */

function toBookmark(post, items) {
  if (!post) return null;
  const list = items || state.index.media.filter((m) => m.postId === post.id);
  {
    const out = { ...post };
    delete out.mediaIds;
    delete out.haystack;
    delete out.id;
    delete out.createdAt;
    delete out.capturedAt;
    out.tweet_id = post.id;
    out.captured_at = new Date(post.capturedAt || 0).toISOString();
    out.media_items = list.map((m) => ({
      type: m.kind === "gif" ? "animated_gif" : m.kind,
      url: m.kind === "photo" ? m.full : m.thumb,
      poster: m.poster || m.thumb,
      mp4: m.video,
      aspect: m.aspect,
      width: m.w,
      height: m.h,
      duration: Math.round((m.dur || 0) * 1000),
      position: m.pos,
      alt: m.alt || undefined,
    }));
    return out;
  }
}

function writeDownload(bookmarks, filename) {
  const payload = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    derived_from: state.source || "browser",
    note: "Exported from the Archive dashboard. The unused `raw` payload is not included.",
    bookmarks,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** The current multi-selection, exported as its own archive file. */
export function downloadItems(ids) {
  const wanted = new Set(ids);
  const byPost = new Map();
  for (const m of state.index.media) {
    if (!wanted.has(m.id)) continue;
    if (!byPost.has(m.postId)) byPost.set(m.postId, []);
    byPost.get(m.postId).push(m);
  }
  const bookmarks = [];
  for (const [pid, items] of byPost) {
    const out = toBookmark(state.index.posts.get(pid), items);
    if (out) bookmarks.push(out);
  }
  if (!bookmarks.length) { toast("Nothing selected to export"); return; }
  writeDownload(bookmarks, `archive-selection-${new Date().toISOString().slice(0, 10)}.json`);
  toast(`Exported ${bookmarks.length} post${bookmarks.length === 1 ? "" : "s"} from your selection`);
}

function download(sheet) {
  const bookmarks = [];
  for (const post of state.index.posts.values()) {
    const out = toBookmark(post);
    if (out) bookmarks.push(out);
  }

  writeDownload(bookmarks, `archive-${new Date().toISOString().slice(0, 10)}.json`);
  sheet.close();
  toast(`Exported ${bookmarks.length} bookmarks`);
}
