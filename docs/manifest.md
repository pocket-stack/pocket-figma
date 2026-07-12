# `pocket.json` — Pocket app contract (format 2)

`pocket.json` describes the portable contract between this application and a
PocketJS target. It is strict data: the framework validates it, resolves a
target profile, and writes a hashed `ResolvedBuildPlan` before either the JS
compiler or native toolchain runs.

Pocket Figma intentionally declares a PSP-shaped baseline rather than separate
PSP and Vita applications:

- a 480×272 logical canvas with `integer-fit` presentation;
- DrawList UI and baked glyphs;
- physical buttons and one analog stick;
- host ABI 1.

The PSP profile satisfies that contract at 1×. The Vita profile satisfies the
same contract at an exact 2× fullscreen scale on 960×544. Touch is absent from
both `requires` and `enhances`, so this version neither needs nor claims it.

## Capabilities

Every capability is a versioned requirement. Parameters are checked according
to the framework registry; for example, `input.analog` uses an `at-least`
relationship for `sticks`. Requesting two sticks would therefore fail Vita
target resolution today instead of silently dropping the second stick.

The four requirements in this app are:

| capability | version | parameters |
|---|---:|---|
| `ui.drawlist` | 1 | — |
| `text.glyphs.baked` | 1 | — |
| `input.buttons` | 1 | — |
| `input.analog` | 1 | `sticks: 1` |

DeepZoom is implemented over the declared DrawList/baked-asset host surface;
it is not a separate platform capability.

## Viewport and packages

The application owns only its logical viewport and presentation intent. The
selected target profile owns the physical display and resolves the scale. PSP
and Vita package entries are metadata overrides on deterministic framework
defaults; they do not select targets or contain build behavior.

Build behavior stays in `scripts/`. Both native build drivers ask the vendored
PocketJS CLI to validate the manifest and target-specific TypeScript, compile
from the resulting `.pocket/<target>/plan.json`, and pass that same plan's
target, ABI, contract hash, and viewport to Cargo. The native PocketJS host
exposes the target/ABI/hash back to the bundle at boot, preventing a stale or
cross-target binary from starting.

Asset provenance, bake commands, store copy, and repository metadata stay in
the README/package metadata rather than the platform compatibility contract.
