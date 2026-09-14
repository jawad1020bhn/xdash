/* =============================================================================
   composer — adding to the archive.

   An archive that can only be read is a museum; this sheet makes it a
   notebook. Text plus up to four photos from the device, downscaled on import
   so a phone photo costs hundreds of kilobytes instead of megabytes, saved as
   a local entry that appears everywhere the export's posts do.

   Everything is local-first, so posting works offline by construction: the
   entry is written to storage and merged into the live index in the same
   gesture, and the draft autosaves on every keystroke, so killing the app
   mid-sentence loses nothing.
   ============================================================================= */

import { h, icon, haptic } from "../ui/dom.js";
import { overlay, toast, confirm } from "../ui/feedback.js";
import { state, set } from "../core/state.js";
import { YOU_AVATAR, addLocalEntry, loadDraft, queueDraftSave, clearDraft } from "../core/local.js";

const MAX_PHOTOS = 4;
const MAX_DIM = 1600;   // downscale target; a 1600px JPEG is plenty on a phone
const MAX_TEXT = 2000;

let open = null;

export function openComposer() {
  if (open) {
    open.el.querySelector("textarea")?.focus();
    return open;
  }

  let photos = [];
  let posted = false;

  const text = h("textarea.composer__text", {
    rows: "4",
    maxlength: String(MAX_TEXT),
    placeholder: "Write something worth keeping…",
    "aria-label": "Entry text",
  });
  const count = h("span.composer__count.t-tiny.t-num", { text: "0" });
  const fileInput = h("input", {
    type: "file", accept: "image/*", multiple: true, hidden: true,
    "aria-hidden": "true", tabindex: "-1",
  });
  const attachBtn = h("button.btn.composer__attach", { type: "button" },
    icon("image", 18), h("span", { text: "Add photos" }),
    h("small", { text: `up to ${MAX_PHOTOS}` }));
  const previews = h("div.composer__previews", { hidden: true });
  const postBtn = h("button.btn.btn--primary.composer__post", {
    type: "button", disabled: true, text: "Post",
  });
  const discardBtn = h("button.composer__discard", {
    type: "button", hidden: true, text: "Discard draft",
  });

  const dirty = () => text.value.trim().length > 0 || photos.length > 0;

  const sheet = overlay({
    title: "New entry",
    size: "md",
    onClose: () => {
      open = null;
      /* Closing is always safe: the draft is already saved. Say so once. */
      if (!posted && dirty()) toast("Draft kept — it will be here when you return");
    },
  });
  open = sheet;

  sheet.content.append(h("div.composer",
    h("p.composer__as", {}, "Posting as ", h("b", { text: "You" })),
    text,
    h("div.composer__meta", count, discardBtn),
    attachBtn, fileInput, previews,
    h("div.composer__foot",
      h("small.composer__hint", { text: "Photos make an entry — add at least one." }),
      postBtn,
    ),
  ));

  /* ------------------------------------------------------------ paint -- */

  function paint() {
    count.textContent = `${text.value.length}${photos.length ? ` · ${photos.length} photo${photos.length > 1 ? "s" : ""}` : ""}`;
    postBtn.disabled = photos.length === 0;
    discardBtn.hidden = !dirty();

    previews.hidden = photos.length === 0;
    if (photos.length) {
      previews.replaceChildren(...photos.map((p, i) =>
        h("span.composer__thumb",
          h("img", { src: p.dataUrl, alt: `Attached photo ${i + 1}` }),
          h("button.composer__remove", {
            type: "button",
            "aria-label": `Remove photo ${i + 1}`,
            onclick: () => {
              photos = photos.filter((_, j) => j !== i);
              paint();
            },
          }, icon("close", 14)),
        ),
      ));
    }

    if (!posted) {
      queueDraftSave({ text: text.value, photos, updatedAt: Date.now() });
    }
  }

  function autogrow() {
    text.style.height = "auto";
    text.style.height = `${Math.min(168, text.scrollHeight)}px`;
  }

  text.addEventListener("input", () => { autogrow(); paint(); });
  attachBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])].slice(0, MAX_PHOTOS - photos.length);
    fileInput.value = "";
    if (!files.length) return;
    attachBtn.disabled = true;
    try {
      const done = await Promise.all(files.map(fileToPhoto));
      photos = [...photos, ...done.filter(Boolean)].slice(0, MAX_PHOTOS);
      haptic(8);
    } catch {
      toast("Those photos could not be read.");
    } finally {
      attachBtn.disabled = false;
      paint();
    }
  });

  discardBtn.addEventListener("click", async () => {
    const yes = await confirm({
      title: "Discard this draft?",
      message: "The text and photos you added here will be thrown away.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (!yes) return;
    text.value = "";
    photos = [];
    autogrow();
    await clearDraft();
    paint();
  });

  postBtn.addEventListener("click", async () => {
    if (!photos.length || postBtn.disabled) return;
    postBtn.disabled = true;
    const label = postBtn.textContent;
    postBtn.textContent = "Posting…";
    try {
      const raw = buildRaw(text.value.trim(), photos);
      const [{ mergeLocal, project }] = await Promise.all([import("../core/data.js")]);
      await addLocalEntry(raw);
      set({ index: mergeLocal(state.index, [raw]) });
      posted = true;
      await clearDraft();
      sheet.close();
      haptic(14);
      const extra = project([raw]);
      toast("Saved to your archive", {
        action: "View",
        onAction: () => import("../viewer.js").then((m) => m.openViewer(extra.media, 0)),
        duration: 6000,
      });
    } catch {
      toast("That entry could not be saved.");
      postBtn.disabled = false;
      postBtn.textContent = label;
    }
  });

  /* A draft from a previous session restores silently — it is yours. */
  loadDraft().then((draft) => {
    if (!draft || posted || !open) return;
    if (typeof draft.text === "string") text.value = draft.text.slice(0, MAX_TEXT);
    if (Array.isArray(draft.photos)) photos = draft.photos.filter(validPhoto).slice(0, MAX_PHOTOS);
    if (text.value || photos.length) { autogrow(); paint(); }
  });

  setTimeout(() => text.focus({ preventScroll: true }), 80);
  return sheet;
}

function validPhoto(p) {
  return p && typeof p.dataUrl === "string" && p.dataUrl.startsWith("data:image");
}

/* ------------------------------------------------------------------ raw -- */

function buildRaw(text, photos) {
  const now = new Date().toISOString();
  const id = `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    tweet_id: id,
    author_name: "You",
    author_username: "you",
    author_profile_image_url: YOU_AVATAR,
    text,
    tweet_created_at: now,
    captured_at: now,
    source_type: "local",
    has_media: true,
    media_types: ["photo"],
    media_items: photos.map((p, i) => ({
      type: "photo",
      url: p.dataUrl,
      width: p.w || 0,
      height: p.h || 0,
      position: i + 1,
      alt: "",
    })),
  };
}

/* ---------------------------------------------------------------- images -- */

/**
 * A picked file becomes a downscaled JPEG data URL. Every step has a
 * fallback, because a photo pipeline that throws is a composer that eats
 * pictures: no ImageBitmap, no canvas, or an animated GIF all degrade to the
 * file's own bytes.
 */
async function fileToPhoto(file) {
  try {
    if (file.type === "image/gif" || typeof createImageBitmap !== "function") {
      return { dataUrl: await readAsDataUrl(file), w: 0, h: 0 };
    }
    const bmp = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { dataUrl: await readAsDataUrl(file), w: 0, h: 0 };
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (!blob) return { dataUrl: await readAsDataUrl(file), w: 0, h: 0 };
      return { dataUrl: await readAsDataUrl(blob), w, h };
    } finally {
      bmp.close?.();
    }
  } catch {
    try { return { dataUrl: await readAsDataUrl(file), w: 0, h: 0 }; }
    catch { return null; }
  }
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
