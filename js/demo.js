/* =============================================================================
   Demo / User data — EMPTY by default

   This file is intentionally empty. Previously it contained pre-installed
   sample media (picsum photos + sample videos). That has been removed.

   HOW TO USE (no import needed):
   1. Open this file in your editor
   2. Paste your JSON posts array directly into `bookmarks` below
   3. Reload the dashboard (when opened outside the extension, e.g. via
      file:// or local server, it reads from localStorage or this file)

   Example:
     window.XB_DEMO = {
       bookmarks: [
         {
           tweet_id: "123456",
           text: "example",
           author_username: "someone",
           author_name: "Someone",
           tweet_created_at: "2026-01-01T00:00:00.000Z",
           captured_at: "2026-01-02T00:00:00.000Z",
           media_items: [
             { type: "photo", url: "https://...", width: 1200, height: 800, aspect: 1.5, position: 1 }
           ],
           like_count_at_capture: 100,
           retweet_count_at_capture: 10,
           view_count_at_capture: 1000,
           capture_order: 1
         }
       ]
     };

   You can also paste a raw JSON array exported from the extension directly.
   If you have a file like `bookmarks.json`, copy its contents (the array)
   into the bookmarks array below.

   Leave it as [] if you want a truly empty library.
   ============================================================================= */

window.XB_DEMO = {
  bookmarks: [
    // PASTE YOUR POSTS HERE — see example above
  ]
};
