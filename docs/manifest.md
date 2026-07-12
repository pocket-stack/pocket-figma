# `pocket.json` — the Pocket app manifest (format 1)

Every Pocket app carries one `pocket.json` at its repository root. It is the
single machine-readable description of the app: what it is, what engine
features it needs, how its assets bake, how each target builds, and how a
store should present it. It plays the role `package.json` plays for npm and
`AndroidManifest.xml` plays for Android — and it is designed for the two
consumers coming next:

- **Pocket Studio** (macOS IDE): reads `app`, `assets`, and `targets` to
  drive Run/Bake/Package buttons without executing project code.
- **Pocket Store** (the UGC registry): reads `id`, `version`, `engine`, and
  `store` to index, gate, and present published apps.

Design rules, in priority order:

1. **Pure data.** JSON, never executable. A store or IDE must be able to
   parse a manifest from an untrusted archive without running anything.
   (Build-time *behavior* — themes, keyframes — stays in `pocket.config.ts`;
   the manifest may point at commands but never contains code.)
2. **Two names, one identity.** `id` is a reverse-DNS string that never
   changes across renames, forks stay distinguishable, and the store keys
   everything on it. `name` is the human/registry slug (`pocket-figma`,
   `pocket-notion`, `pocket-linear` — the `pocket-<product>` convention).
3. **Capabilities are declared, not discovered.** Engines grow (deep-zoom
   tile streaming and the analog nub arrived in pocketjs#81); a 2004 PSP
   running an older EBOOT host cannot polyfill. `engine.capabilities` lets
   the store filter incompatible apps *before* download and lets Studio warn
   at edit time.
4. **Baking is a first-class phase.** Pocket apps compile their runtime cost
   away (`RUNTIMES.md` law: the device never parses, it only consumes).
   `assets.bake` names the command; `assets.prebaked` names the committed
   outputs so CI and the store can build without private sources;
   `assets.sources` records provenance and licensing of what was baked in.

## Fields

### Identity

| field | type | meaning |
|---|---|---|
| `pocket` | int | manifest format version. This document describes `1`. |
| `id` | string | reverse-DNS, permanent. Store identity, save-data namespace, update lineage. |
| `name` | string | kebab-case slug; registry/package/URL name. Convention: `pocket-<product>`. |
| `title` | string | display name (XMB entry, Studio window, store page). |
| `version` | semver | app version. The store enforces monotonic publishes per `id`. |
| `description` / `authors` / `license` / `repository` | | as in npm. |

### `engine`

| field | type | meaning |
|---|---|---|
| `pocketjs` | semver range | engine versions the bundle is built against. |
| `capabilities` | string[] | host features the app cannot run without. Known today: `ui` (the 2D DrawList surface), `deepzoom` (TILESET streaming ops 23–25), `analog` (nub in the frame contract), `3d` (pocket3d surface). Registry grows append-only. |

### `app`

| field | type | meaning |
|---|---|---|
| `entry` | path | the mounting entry (calls `mount()`); what the bundler builds. |
| `framework` | `solid` \| `vue-vapor` | JSX flavor, passed to the PocketJS build. |
| `kind` | `viewer` \| `game` \| `tool` \| `toy` | coarse taxonomy; seeds store categories and Studio templates. |
| `simulationHz` | int | the virtual-clock policy the app is tuned for (60 unless it opts down). |

### `assets`

| field | type | meaning |
|---|---|---|
| `bake` | command | regenerates prebaked assets from sources. Studio's "Bake" button. |
| `prebaked` | path[] | committed bake outputs; everything a build needs with no sources present. |
| `sources` | object[] | provenance: `name`, `origin` URL, `author`, `license`, free-form `note`. The store surfaces these credits. |

### `targets`

One key per shipping target. Absence means "not supported" — Studio greys
the run button, the store hides the download.

- `psp`: `crate` (the EBOOT bin crate), `title` (PARAM.SFO, ≤128 bytes),
  `icon0` (144×80 PNG shown in the XMB), `pic1` (480×272 PNG backdrop),
  `memoryBudgetMb` (audited high-water the app promises to stay under —
  the store shows it, hardware CI enforces it).
- `vita`: `crate` (the VPK bin crate), `titleId` (nine uppercase ASCII
  letters/digits), `title` (LiveArea bubble name), `icon0` (128×128 PNG),
  `viewport` (`logical`, `physical`, and `scale`; PocketJS apps normally keep
  the 480×272 logical canvas and stretch it exactly 2× across Vita's 960×544
  display), `touch` (whether the app binds either touchscreen), and
  `memoryBudgetMb`.
- `desktop`: `host` — which vendored host runs it (`uihost` today).
- `web`: `host` — `host-web` today.

### `store`

Presentation only — nothing here affects builds. `categories`, `tags`,
`icon` (square, any size ≥256), `screenshots` (repo-relative paths),
`privacy` (`network`/`storage`: `none` | `reads` | `writes` — a PSP app is
usually `none`/`none`, and the store says so on the listing).

## What the manifest is not

- Not a lockfile: engine pinning is the submodule/lockfile's job; the range
  in `engine.pocketjs` states *compatibility*, not resolution.
- Not a build script: `targets.*` names crates and hosts; the repo's
  `scripts/` own the how.
- Not a config: runtime theme/keyframes stay in `pocket.config.ts` beside
  the entry, evaluated at build time by the PocketJS compiler.
