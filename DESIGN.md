# Archive — Design System (“The Screening Room”, v3.3)

The source of truth for the product's look, feel and motion. Built with the
[OpenDesign](https://github.com/nexu-io/open-design) skill set —
`frontend-design` (direction + craft), `taste-skill` (anti-slop discipline),
`web-design-guidelines` (Vercel UI standards) and `emilkowalski-motion`
(restrained animation).

> **Design read:** a personal media-archive product — player-first,
> media-loud — for a solo owner who opens it daily. Noir-editorial cinematic
> language, native CSS, zero downloads. Dials: variance 7 / motion 5 /
> density 4.

## 1 · Direction

The archive is a private collection, so the product dresses like the room you
watch it in: warm near-black (or warm paper), one ember accent, hairline
rules, a serif voice for masthead moments, and a whisper of film grain over
everything. Media stays loud; chrome stays quiet.

Anti-slop commitments (enforced by `tools/check.js` where cheap):

- **One accent.** Ember `#ff4e2e` (dark) / `#d9381c` (light). No gradients on
  chrome — `--brand` is a solid. The magenta→violet ramp is gone.
- **No purple glow, no glass-everything, no blobs.** Depth is one hairline +
  one soft warm shadow. Frosted blur exists only on floating chrome (top bar,
  dock, sheets, viewer controls).
- **Zero downloads.** The serif display face is the platform serif stack, so
  the offline-first contract survives the reskin untouched. No webfonts, no
  icon CDN, no CSS framework.
- **One palette per theme.** Warm neutrals throughout; section hues are
  functional tints (chips, row icons, meters), never decoration.

## 2 · Tokens (`styles/tokens.css`)

| Family | Key tokens |
|---|---|
| Brand | `--brand-1` ember, `--brand-2` marquee amber (second chart series only), `--brand` solid alias, `--on-brand` |
| Hues | `--hue-a…f`: signal ember 8 · marquee amber 38 · projector cyan 205 · moss 95 · gold 45 (stars) · teal 165 |
| Canvas (dark) | `--bg #0c0a09`, `--bg-2`, `--surface`, `--surface-2`, `--surface-3`, `--chrome` (frosted bars) |
| Canvas (light) | `--bg #f5f2ec` warm paper, ink text `#171310` |
| Text | `--text`, `--text-2`, `--text-3` (warm, never pure gray) |
| Lines | `--line` 8.5%, `--line-2` 16%, `--hi` top-light on raised panels |
| Type | `--font-display` platform serif · `--font` platform grotesk · `--font-mono`; scale `--fs-display` 36–68 → `--fs-tiny` 11 |
| Shape | `--r-xs 8` kbd/thumbs · `--r-sm 10` row icons · `--r-md 14` media · `--r-lg 18` spotlight/cards · `--r-xl 24` sheets · `--r-pill` |
| Motion | `--t-fast 140ms` · `--t-ui 220ms` · `--t-slow 480ms` · `--ease-out` · `--spring` |
| Grain | `--grain-blend` overlay/multiply · `--grain-alpha` .09/.07 |

**Shape rule (documented, per taste-skill):** screens 24 · media 14 ·
controls pill · people and round actions circular. Nothing else ships a radius.

**Load-bearing values** (JS and tests depend on them — see §6):

- `--tile-min` / `--gap` / `--tile-aspect` drive the windowed grid packer.
- `.tile__meta` is exactly **27px** (7px top padding + 20px row) = `META_H`.
- `data-theme/density/aspect/motion/blur` attributes; `.hue` tint family;
  `--brand-1/2`, `--ok`, `--warn`, `--danger` referenced by charts and sheets.

## 3 · Type

- **Display (serif):** greeting masthead (second word italic ember), lock
  screen wordmark, sheet titles, empty states, rail titles, stat numerals.
  Tight tracking (`-0.015em`), `text-wrap: balance`.
- **UI (grotesk):** everything interactive and informational.
- **Mono:** kbd, rail index numbers, badges, counters, timestamps.
- **Kicker (`.t-kicker`):** 11px caps + ember ticket square — above the
  masthead (with a localized date line), the spotlight, dialogs.
- Numerals are tabular everywhere stats live.

## 4 · Surfaces

- **Top bar:** floats transparent, frosts on scroll. Section wordmark in caps
  with ember dot · centred search pill (`/`/`⌘K`) · theme + menu actions.
- **Phone dock:** floating rounded tab bar with blur, hairline and shadow;
  active tab gets an ember-tinted pill. Desktop ≥1080px swaps it for the
  **sidebar**: italic serif wordmark, nav with ember active bar, archive
  totals in the foot.
- **Home:** masthead (kicker + serif greeting + totals + solid ember CTA) →
  resume card → cinematic spotlight (21:10, caption on the scrim) → five
  numbered rails (`01`–`05`) → creators (`06`) → hairline stat strip (no
  cards) → library door.
- **Tiles:** 14px media, lift + ring on hover, star badge pinned on starred
  frames (touch has no hover veil), ember resume hairline on parked clips,
  mono duration/count badges.
- **Library:** search bar sticks under the top bar with frosted blur while
  the archive scrolls beneath; hue-tinted facet chips; author header with a
  3px hue rule.
- **Watch:** full-bleed snap feed, floating glass top cluster, mono counter
  pill, ember progress hairline.
- **Viewer:** floating control dock, serif-free dense stats, filmstrip with
  ember current-ring, swipe + full keyboard map.
- **Palette:** 20px command box, ember inset tick on selection, match
  highlighting, footer key hints.
- **Lock:** the curtain before the room — ember radial vignette, centred
  masthead, oversized letterspaced PIN field.
- **Overlays/toasts/empty states:** serif titles, hairline cards, ember
  primary actions.

## 5 · Motion

- 140/220ms for controls, 480ms for page reveals; `transform`/`opacity`
  only; one spring curve; staggered rail entrances (≤12 steps × 45ms).
- `prefers-reduced-motion` and the in-app Reduce motion switch zero all
  durations and kill decorative loops (shimmer, spin, entrances).

## 6 · Contracts (do not break while restyling)

`tools/check.js` boots the real app in jsdom at 390px and 1440px and asserts
on the document. The styling contracts that matter:

1. Class names are API: `.lock__card`, `.tab[data-route]`,
   `.side__item[data-route]`, `.greet(.greet__cta)`, `.home .spotlight`,
   `.block__title h2` (exact rail titles), `.home .rail` ×5, `.home .creator`,
   `.home__foot .stat` ×4, `.lib(.lib__bar input, .lib__facets .chip,
   .lib__count)`, `.grid .tile`, `.watch[data-fit]` + `.watch__cell/top/act`,
   `.vw(.vw__stage, .vw__bar, .vw__film)` + crop-to-fill toggles,
   `.pal(.pal__in input, .pal__item)`, `.ins__cell` ×4, `.mix__row`,
   `.board__row`.
2. Grid geometry: single column width, no overlap, `--aspect` per tile.
3. Design tokens: ember `--brand-1`, solid `--brand`, serif
   `--font-display`, no remote stylesheets.

Run it: `npm install`, then `npm start` (one shell) and `npm test` (another).
