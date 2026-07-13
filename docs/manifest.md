# `pocket.json` — Pocket app contract (format 2)

`pocket.json` describes the portable contract between this application and a
PocketJS target. It is strict data: the framework validates it, resolves a
target profile, and writes one checksummed build plan before either the JS
compiler or native toolchain runs.

Pocket Figma intentionally declares a PSP-shaped baseline rather than separate
PSP and Vita applications:

- a 480×272 logical canvas with `integer-fit` presentation;
- baked glyph text;
- physical buttons and one analog stick;

The PSP profile satisfies that contract at 1×. The Vita profile satisfies the
same contract on its 960×544 fullscreen output and resolves a raster density of
2. The viewer selects its matching checked-in tile manifest through
`platform.pixelRatio`; target names never enter application code. Touch is
absent from both `requires` and `enhances`, so this version neither needs nor
claims it.

## Capabilities

Capabilities are plain framework API identifiers. A target advertises only
APIs its stock host has implemented and tested; the manifest's `requires`
entries must all be present or resolution fails.

The three requirements in this app are:

| capability |
|---|
| `text.glyphs.baked` |
| `input.buttons` |
| `input.analog.left` |

DrawList is PocketJS's internal core-to-backend rendering IR, not an API this
application can observe or request, so it is intentionally not a capability.
DeepZoom is implemented over the public host surface; it is not a separate
platform capability.

## Viewport and build boundary

The application owns only its logical viewport and presentation intent. The
selected target profile owns the physical display. Package metadata remains
in the native PSP/Vita projects until a PocketJS backend actually consumes it.

Build behavior stays in `scripts/`. Both native build drivers ask the vendored
PocketJS CLI to validate the manifest, run the ordinary reachable TypeScript
check, and compile from `.pocket/<target>/plan.json`. The public
`extractHostBuildInputs()` helper verifies the plan checksum and projects only
the app output, target, ABI, and viewport required by a custom host. At boot
PocketJS compares target and host ABI; the plan checksum is build-time
consistency data, not a runtime trust mechanism.

Asset provenance, bake commands, store copy, and repository metadata stay in
the README/package metadata rather than the platform compatibility contract.
