# Archive — frontend rebuild

A from-scratch replacement of the dashboard frontend. Same data contract, same
storage keys, no build step. Everything else is new.

The previous implementation is in git history at `07d7149` (`js/`, `css/`, `m3e/`).

---

## 1 · Diagnosis

Findings below were measured against the previous build, not inferred from
reading it.

### First load moved 17.71 MB, 93% of it dead weight

`POSTS.json` is 17.71 MB. Of that, **6.87 MB (38.8%) is a `raw` field** holding
verbatim Twitter API payloads. Grepping the old codebase for `.raw` returns two
hits, both a local variable named `raw` in `js/library.js` — nothing ever read
the field. The UI needs roughly 1.2 MB.

The file was `fetch`ed and `JSON.parse`d on the main thread during boot, before
anything painted: `body.is-booting` sets `.app, .navbar { opacity: 0 }`
(`css/foundation.css:203`), and that class was only removed at the end of a
successful boot.

### A blank page was the error handler

`app.boot()` was called with no `.catch()` (`js/app.js:923`) and `boot()` had no
`try`. Combined with the opacity rule above, any throw anywhere in a long async
chain produced a permanently white page with no message, no stack and no retry.

I confirmed this by running the old app in a DOM without `matchMedia`: every
global loaded, `boot()` never completed, and the document stayed empty with zero
errors surfaced.

### A hard-coded password blocked the product

`js/lock.js` contained `const PASSWORD = "2055"` in plaintext and suspended
`boot()` until it was entered. Its own comment conceded it is not security. It
turned every first visit into a dead end, and the manifest's shortcuts landed on
a lock screen.

### Two responsive systems, one of which did nothing

- JS: `XBMobile.isCompact()` = `max-width: 719px` (`js/mobile.js:19`); `js/card.js:24` used the same 719.
- M3E `bindWindowClass()` wrote `data-window-class` using 599/839/1199/1599 (`m3e/interactions.js:346`), recomputed on every resize.
- **Zero CSS rules consumed `data-window-class`.** A resize handler ran to set an attribute nothing read, while the real breakpoints were eight hardcoded values in CSS: 379, 599, 719, 899, 1023, 1199, 1439, 1440.

### Mobile was an override sheet on a desktop base

`css/mobile.css` states its own approach in line 5: *"An ADAPTATION layer, not a
rewrite. The desktop system above is untouched."* Nine stylesheets, 6,158 lines,
where every mobile fix had to win a cascade against four others. `html, body {
overflow-x: clip }` was used to hide overflow rather than fix it.

### Touch targets under 44px

`.card__pick` 34×34 (the multi-select checkbox on a media grid — the highest
mis-tap risk in the app), `.search__chips .pill` 40px, `.seg__item` 40px,
`.discover__refresh` 42px, `.hero__actions .ctl--accent` 42px.

### Images asked for full-size renditions

Every photo URL shipped bare — no `?name=` parameter and no `srcset`. A 170px
thumbnail slot downloaded a ~1200px image. Measured across the rendered grid:
`srcset: 0`, sized URLs: 0.

### No alt text anywhere

88 `<img>` elements in the initial render, 0 with a non-empty `alt`.

### 48 persisted preferences

Roughly 22 exposed across six settings sections, most of them decisions the
product should simply have made.

### The service worker precached the wrong files

`index.html` requested `?v=16`; `sw.js` precached `?v=14`. Forty entries, none of
them a URL the app asked for. Its own comment admitted the coupling: *"Keep in
sync with the HTML asset list (a build step would own this)."*

### The design system fought itself

`css/foundation.css` says it outright: *"theme.js writes `--md-sys-color-*` as
INLINE styles on `<html>`, so they cannot be overridden from a stylesheet.
Rather than fight it, the product palette lives in its own namespace."* Two
colour systems with one accent borrowed across the seam.

---

## 2 · What "better" meant here

This is a personal media archive: 978 posts, 1,205 media items, 529 creators,
55% of them portrait or taller. One person, on a phone, looking for something
they half-remember saving.

So the standard was not "more features". It was:

1. **The media is the product.** Chrome earns its pixels or loses them.
2. **Predictable beats clever.** The old Discover generated up to eleven
   algorithmic rails and rotated them on every load, so the page you returned to
   was never the page you left. Home is now the same sections, same order, every
   time.
3. **Fast on the device that matters.** A mid-range phone on a real connection.
4. **One way to do each thing.** Four surfaces for "find something" became one.

---

## 3 · Key decisions

### 93% smaller first load

`npm run build` projects `POSTS.json` into `data/posts.slim.json`, dropping
`raw` and every other unused field.

```
POSTS.json           17.71 MB
data/posts.slim.json  1.22 MB  (93.1% smaller)
```

`POSTS.json` is left exactly as the capture extension wrote it — this is a
read-side projection, not a migration. The app prefers the slim file and falls
back to `POSTS.json` automatically, so deleting the output is always safe.

The projection is then cached in IndexedDB, keyed on the source file's HTTP
fingerprint (`Last-Modified` + `Content-Length` + `ETag`, read with a `HEAD`
request). An unchanged file costs one `HEAD` and **zero JSON parsing** on reload.

### Mobile-first, with two breakpoints shared by CSS and JS

The base styles are the phone. `min-width` blocks only add. There are exactly two
breakpoints — **720px and 1080px** — and `src/ui/dom.js` reads the same two
numbers, so JS and CSS cannot disagree. One `data-bp` attribute replaces the
dead `data-window-class`.

`--tap: 44px` is a token. Nothing interactive goes below it.

### The grid is windowed

1,205 items would be 1,205 DOM subtrees and 1,205 image requests. Library renders
only rows near the viewport plus two rows of overscan, and keeps the scroll
height honest with a sized viewport. Measured in the test: **16 tiles in the DOM
for 1,205 items**, with 157,232px of scroll height behind them.

Tiles are a uniform aspect ratio deliberately. Masonry photographs better and
makes both windowing and scanning worse.

### One command surface

The command palette (`/`, `⌘K`, or the search button on a phone, where it becomes
a sheet) covers posts, creators and commands. It replaces the search dropdown,
the filter sheet, the "More" sheet, and two navigation destinations.

Three destinations remain: **Home, Library, Watch**.

### Media handling

- Aspect-ratio boxes are reserved before the image arrives, so a 1,200-item grid never reflows as it fills in.
- Thumbnails request `?name=small` / `?name=medium` via `srcset`; avatars swap `_normal` for `_200x200`.
- Every image has alt text: the creator's `alt` when present, otherwise a composed description.
- `loading="lazy"` + `decoding="async"` throughout; only above-the-fold tiles are eager.

> **Unverified:** outbound network to `pbs.twimg.com` is blocked in this sandbox,
> so I could not confirm the CDN honours those size names. `media.js` therefore
> strips the `srcset` and retries the bare URL on `error` — if the guess is
> wrong, the worst case is exactly today's behaviour.

### The lock is now the user's

The hard-coded password is gone. A PIN is opt-in, user-chosen, and the settings
sheet says plainly that it stops a shoulder-surf and not an attacker — because
everything here ships to the browser.

### The service worker has no list to maintain

`sw.js` fetches `index.html` at install, reads the assets it references, then
walks the ES module graph by following each module's own `import` statements.
The precache is derived from the shipped files at install time, so the drift
class is gone rather than fixed.

### Native ES modules, still build-free

Explicit dependency graph, no global namespace, no load-order comments. The cost
is that `file://` no longer works — `index.html` detects it and prints the
one-line serve command instead of failing silently. `npm start` serves over http.

### Twelve preferences instead of forty-eight

Kept what genuinely varies between people: theme, density, motion, playback
behaviour, blur-on, seen-dimming, and the PIN.

---

## 4 · Layout

```
index.html              shell, boot skeleton, crash surface
styles/tokens.css       the only place a value is decided
styles/base.css         reset, type scale, shell
styles/components.css   buttons, chips, sheets, toasts, tiles
styles/views.css        home, library, watch, viewer, palette, settings
src/main.js             boot, error boundary, lock, SW registration
src/shell.js            top bar, navigation, routing, hotkeys
src/viewer.js           the full-screen media theatre
src/core/store.js       persistence — same keys as before
src/core/data.js        load + project + fingerprint cache
src/core/state.js       one store, one subscription channel
src/core/query.js       filter, sort, search, stats
src/ui/dom.js           h(), breakpoints, haptics, motion
src/ui/icons.js         24px icon set, returned as elements
src/ui/media.js         images, video, formatting
src/ui/card.js          one card component, three shapes
src/ui/feedback.js      toasts, sheets, confirms
src/ui/palette.js       the command palette
src/ui/actions.js       item actions and the selection bar
src/views/*.js          home, library, watch, settings, manage
tools/build-slim.js     POSTS.json → data/posts.slim.json
tools/serve.js          dependency-free dev server
tools/check.js          the smoke test
```

### Compatibility

Unchanged, deliberately: the `POSTS.json` schema, and the storage keys
`xBookmarks`, `xLibraryState`, `xDashboardPrefs`. An existing archive in the
browser or the extension opens as-is. Exports are written back in the same
schema, so a file round-trips — minus `raw`, which is the point.

---

## 5 · Verifying it

```
npm install
npm start          # in one shell
npm test           # in another
```

`tools/check.js` boots the **real** modules — `src/main.js` and everything it
imports — against a jsdom DOM pointed at the live data file, then asserts on the
resulting document. Nothing is re-implemented in the harness; if it passes, the
shipping code ran. jsdom is a DOM and not a browser, so `matchMedia`,
`IntersectionObserver`, `requestAnimationFrame`, layout and media playback are
stubbed. Application logic is not.

Current result:

```
[archive] indexed 1205 items in 406ms from ./data/posts.slim.json
21/21 checks passed
```

Covered: boot reaches the shell without the crash surface; three destinations;
the greeting reports the real archive size; feature card, sections, rails and
creators render; every image has alt text; thumbnails are lazy and request a
small rendition; initial HTML stays at 138 KB; the Library grid is windowed to 16
tiles with correct scroll height; search narrows the result count; zero runtime
errors.

## 6 · Known gaps

Stated plainly rather than papered over:

- **No visual screenshots.** Outbound network to the Playwright CDN is blocked
  here, so no real browser was available. Layout is reasoned from CSS and
  asserted structurally, not eyeballed. This is the largest gap.
- **`pbs.twimg.com` size names unverified**, for the same reason. Fallback is in
  place; see §3.
- **Watch and the viewer are exercised structurally, not played.** jsdom has no
  media pipeline, so autoplay, seeking and snap-paging are unexercised by the
  test.
- **Icons changed shape.** The PWA icons in `icons/` are the previous brand mark
  and now sit against a dark-first shell; they want redrawing.
