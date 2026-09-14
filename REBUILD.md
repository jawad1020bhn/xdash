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
  active-tab indicator, chart strokes and primary actions.
- **Display voice without a download:** the platform UI face at weight 850 with
  `-0.035em` tracking, tabular numerals on every stat.
- **Depth:** layered surfaces + a 1px top-light (`--hi`) on every raised panel,
  so dark mode reads as material, not void.
- **Motion:** three durations, two curves, one spring; count-ups on KPIs,
  draw-in on chart strokes, grow-in on meters, snap on rails.

## 3 · What each surface is now

- **Home** — hybrid dashboard: greeting with live pulse line, four KPI cards
  (count-up + sparkline), a 12-month *posting activity* area chart with hover
  tooltip, media-mix donut, creator leaderboard with bars, latest-saves feed,
  then a full-bleed Spotlight and five deterministic rails.
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
35/35 checks passed
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
