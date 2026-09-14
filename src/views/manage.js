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

export function openManage() {
  const sheet = overlay({ title: "Import & export" });
  const c = sheet.content;

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
  c.append(h("button.row", { type: "button", onclick: () => pickFile(sheet) },
    h("span.row__icon.hue", { style: { "--hue": "var(--hue-d)" } }, icon("upload", 18)),
    h("span.row__text",
      h("b", { text: "Import an export file" }),
      h("small", { text: "Accepts the extension's JSON: an array, or {bookmarks: []}" }),
    ),
    icon("chevronRight", 16),
  ));

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
    if (!file) return;
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
  });
  input.click();
}

/* ---------------------------------------------------------------- export -- */

function download(sheet) {
  const bookmarks = [];
  for (const post of state.index.posts.values()) {
    const items = state.index.media.filter((m) => m.postId === post.id);
    const out = { ...post };
    delete out.mediaIds;
    delete out.haystack;
    delete out.id;
    delete out.createdAt;
    delete out.capturedAt;
    out.tweet_id = post.id;
    out.captured_at = new Date(post.capturedAt || 0).toISOString();
    out.media_items = items.map((m) => ({
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
    bookmarks.push(out);
  }

  const payload = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    derived_from: state.source || "browser",
    note: "Exported from the Archive dashboard. The unused `raw` payload is not included.",
    bookmarks,
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `archive-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  sheet.close();
  toast(`Exported ${bookmarks.length} bookmarks`);
}
