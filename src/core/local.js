/* =============================================================================
   local — the entries you create on this device.

   The archive this app reads is someone else's export; the entries this
   module keeps are yours. They live under their own storage key so an import
   can never wipe them, and they are merged into whatever index the app loads
   — file, cache or storage — so they show up everywhere the export's posts do.

   Storage only. The merge itself lives in data.js next to project(), because
   that is where the shapes are defined.
   ============================================================================= */

import { KEYS, getMany, setMany, removeMany } from "./store.js";

export const LOCAL_AUTHOR = "you";

/* A generated avatar for "You": an iOS-blue disc with a Y. Stored as the
   author's profile image so every avatar slot in the product renders without
   a special case. */
export const YOU_AVATAR = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
  `<rect width="96" height="96" rx="48" fill="#0A84FF"/>` +
  `<text x="48" y="66" font-size="54" text-anchor="middle" fill="#fff" ` +
  `font-family="system-ui,-apple-system,sans-serif" font-weight="600">Y</text></svg>`,
);

/* ------------------------------------------------------------ entries -- */

let cache = null;

export async function localEntries() {
  if (!cache) {
    const stored = (await getMany([KEYS.local]))[KEYS.local];
    cache = Array.isArray(stored) ? stored : [];
  }
  return cache;
}

export async function addLocalEntry(raw) {
  const list = await localEntries();
  list.push(raw);
  await setMany({ [KEYS.local]: list });
  return raw;
}

/** Removes one entry, returning its raw form so the caller can offer Undo. */
export async function removeLocalEntry(postId) {
  const list = await localEntries();
  const i = list.findIndex((r) => String(r.tweet_id) === String(postId));
  if (i < 0) return null;
  const [gone] = list.splice(i, 1);
  await setMany({ [KEYS.local]: list });
  return gone;
}

/* ------------------------------------------------------------- drafts -- */

let draftTimer = 0;

/** Debounced: called on every keystroke, writes only when you pause. */
export function queueDraftSave(draft) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    setMany({ [KEYS.draft]: draft }).catch(() => {});
  }, 300);
}

export async function loadDraft() {
  try {
    return (await getMany([KEYS.draft]))[KEYS.draft] || null;
  } catch {
    return null;
  }
}

export async function clearDraft() {
  clearTimeout(draftTimer);
  await removeMany([KEYS.draft]).catch(() => {});
}
