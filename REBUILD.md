# Archive v3 — "Pro Dash"

A from-scratch rebuild of the dashboard on top of the one thing v2 got right:
the data contract. Same `POSTS.json` schema, same storage keys
(`xBookmarks`, `xLibraryState`, `xDashboardPrefs`), same build-free ES modules,
same derived service-worker precache. Everything a user sees is new.

Direction, chosen with the owner: **bold media-first** visuals, **hybrid
Home** (analytics band + curated rails), **mobile-first**, and a **full
rewrite** rather than a presentation-layer patch.

---

## 1 · What was wrong with v2 (measured, with screenshots)

| # | Finding | Proof |
|---|---|---|
| 1 | **A fake crash card painted at the bottom of every screen.** `.crash { display: grid }` overrode the `hidden` attribute, so "Something went wrong while opening your archive" plus a destructive-looking *Reset local data* button rendered under the footer on every route, phone and desktop. | v2 full-page captures |
| 2 | **The Library grid was broken above ~1080px.** The windowed grid mis-sized rows: ragged holes, one tile spanning two rows, a phantom horizontal scrollbar mid-page. | v2 desktop capture |
| 3 | **Desktop was a stretched phone app.** Hero locked to a narrow column, rails bleeding off-canvas, ~40% dead space at 1440px. | v2 desktop capture |
| 4 | **Wireframe-grade type.** One system face at small sizes, 11px meta everywhere, no display voice, no hierarchy; the stat strip was a gray row. | v2 captures |
| 5 | **Cards leaked raw post text** — unclamped, explicit, URLs as titles. | v2 captures |
| 6 | **No depth, no brand.** Flat single accent, light theme a gray inversion, 16px avatars. | `tokens.css` (v2) |
| 7 | **A "dashboard" with zero analytics.** No timeline, no mix, no leaderboard. | `views/home.js` (v2) |

v2's engineering was kept where it earned it: the slim projection +
IndexedDB fingerprint cache, windowing as a concept, the overlay/toast
primitives' intent, and the jsdom smoke-test philosophy.

## 2 · The v3 design language

- **Canvas stays quiet, content stays loud.** Near-black `#08080b` (or warm
  paper `#f7f6f3`) with colour existing in exactly two places: the media, and
  the colour-blocking that labels a section. Every hue comes from six tokens
  (`--hue-a…f`); a section sets `--hue` and inherits a tint/chip/line family
  from the `.hue` mixin.
- **Brand ramp** magenta `#ff3d81` → violet `#7c5cff`, used for the mark, the
  active-tab indicator, chart strokes and primary actions. No glows: the v3.0
  canvas wash, coloured button shadows and gradient type were removed in v3.1
  at the owner's request — surfaces are flat, elevation comes from one hairline
  and one soft shadow.
- **Display voice without a download:** the platform UI face at weight 850 with
  `-0.035em` tracking, tabular numerals on every stat.
- **Depth:** layered surfaces + a 1px top-light (`--hi`) on every raised panel,
  so dark mode reads as material, not void.
- **Motion:** three durations, two curves, one spring; count-ups on KPIs,
  draw-in on chart strokes, grow-in on meters, snap on rails.

## 3 · What each surface is now

- **Home** — a media-first front page, not a stats board: an optional
  continue-watching row, a sticky filter chip row (Recent / Unopened / Videos /
  Photos / Starred, each with its real count), and the archive itself in one
  windowed grid — the same surface language as the feeds it archives.
- **Insights** — the counts and charts (headline numbers, 12-month activity,
  media mix, top creators) live one tap deep behind Settings, because this is
  a player first and a dashboard never.
- **Library** — facet chips (kind / unseen / starred), sort sheet, saved views,
  density + tile-shape prefs, and a windowed grid whose geometry is computed
  from the container's real width: tiles are absolutely positioned inside a box
  whose height equals the whole archive, so holes are impossible at any
  breakpoint. 14 tiles in the DOM for 1,205 items on a phone, 49 at 1440px.
- **Watch** — immersive snap feed, three cells alive at once, centred cell
  plays (muted), sticky chrome, action rail.
- **Viewer** — theatre with filmstrip of the post's siblings, swipe + keys,
  star/mute/fullscreen, progress persistence.
- **Palette** (`/`, `⌘K`) — fuzzy subsequence scoring over commands, creators
  and items, with match highlighting and full keyboard navigation.
- **Settings** — eleven human preferences: theme, density, tile shape, motion,
  autoplay, mute, progress, seen-dimming, privacy blur, PIN, landing.

## 4 · Performance

- First load still moves **1.22 MB** of projection (93% smaller than the
  export), cached in IndexedDB against the file's HTTP fingerprint — an
  unchanged archive costs one `HEAD` and zero JSON parsing.
- Windowed grid + `content-visibility: auto` on panels and rail sections.
- Aspect boxes reserved before images arrive: zero layout shift.
- `srcset` small/medium renditions with bare-URL fallback; `loading="lazy"`,
  `decoding="async"`, `fetchpriority="high"` on the spotlight only.
- Route modules prefetch on nav hover/focus.
- Icons are a 0.6 KB SVG + 14/11 KB JPEGs, drawn from geometry, not exported
  from a raster editor.
- Service worker precache is still derived at install time from `index.html`
  and the module graph; `VERSION` bumped so v2 caches purge.

## 5 · Verifying it

```
npm install
npm start      # one shell
npm test       # another
```

`tools/check.js` boots the real modules in jsdom at 390px **and** 1440px and
asserts on the resulting document, including the regressions this rebuild
exists to kill: the crash surface must compute `display: none`, the desktop
grid must produce ≥4 equal-width columns, Watch must rebuild once data lands,
and Escape must close the palette.

```
75/75 checks passed
```

Visual verification was done in a real headless Chromium (screenshots at
390/1440, dark and light, every route and overlay) — the gap v2 explicitly
could not close.

## 6 · Known gaps, stated plainly

- `pbs.twimg.com` size names remain unverified from this sandbox (outbound
  network blocked); the bare-URL fallback still makes a wrong guess harmless.
- Video playback is exercised structurally, not watched: jsdom and the
  sandboxed Chromium both lack the CDN streams.
- The 12-month chart is honest about single-session captures: it plots when
  posts were *originally posted*, and the greeting says "imported … in one go"
  instead of pretending at a 30-day habit.

## 7 · v3.2 — consistent video formats, curated Home, fixed PIN

### v3.2 — one treatment for every video format

Owner report: *"videos size are not all the same, there is different
format."* The archive mixes 9:16 phone clips, 16:9 landscape, square and
ultra-wide media, and v3.1 forced every surface toward one shape, which made
the format mix look broken rather than intentional:

- **Grid cropped every clip to one fixed ratio.** The per-item `--aspect`
  variable was plumbed but never read; `object-fit: cover` centre-cropped
  landscape clips into portrait boxes. The windowed grid now packs tiles
  shortest-column-first (masonry) using each item's real width/height,
  clamped to 0.5–2.2 so a banner frame cannot eat a column.
- **Watch forced every cell to `contain`, so formats visibly changed size
  between swipes.** Watch now defaults to `cover` — every cell is a uniform
  full screen — with a top-bar toggle (and Settings switch) for `contain`
  when the whole frame matters more than uniformity. The viewer theatre
  gets the same toggle (`C`), defaulting to `contain`.
- **One dead MP4 URL meant a black player.** The projection kept only the
  top rendition; `mp4_variants` and `hls` existed in the export but were
  discarded. Every video now ships a best-first source ladder (highest MP4 →
  smaller MP4s → HLS) the browser walks natively, plus a visible badge for
  poster-only exports instead of a black frame.
- Videos resume at saved progress in both surfaces, and the outgoing clip
  is paused before a viewer step.

### v3.2 continued — curated Home + a fixed gate PIN

- **Home is an edit, not a search surface.** The flat chip row + infinite
  windowed grid left Home (they live on unchanged in Library). Home now
  composes: time-aware greeting with archive totals and a "Show unopened"
  CTA → continue-watching row (when progress exists) → one spotlight (newest
  unopened, else newest; title flips under privacy blur) → five horizontal
  rails (Jump back in / Most liked / Long form >3min / Photo stories /
  Recently saved), each with an "All" button that lands on the Library query
  reproducing the rail → top creators row → four stats + "Open the full
  library" CTA. Rails use the standard `tile()` via a new `rail()` export in
  `src/ui/card.js`; strips bleed to the phone screen edge using the stage's
  safe-area padding. Full redraws on store change (≤56 rail tiles total).
- **PIN gate is now always on with the fixed code `2055`.** `src/main.js`
  exports `FIXED_PIN` and the boot gate runs unconditionally before the shell
  mounts; wrong codes keep the shake + "That is not the PIN." alert. The
  Settings Privacy row is informational (no set/change/remove flow); the
  `pin` pref key and storage contracts are untouched. The check harness
  enters the gate on every boot, including a wrong-code assertion.
