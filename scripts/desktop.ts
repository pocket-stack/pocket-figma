// Run the viewer in a native window via the vendored uihost (the pocket3d
// workspace's wgpu shell): same bundle + pak as the PSP EBOOT, QuickJS guest,
// pocketjs-core, wgpu renderer.
//
//   bun scripts/desktop.ts                       # window, 2x scale
//   bun scripts/desktop.ts --screenshot out.png  # headless PNG (+ --frames N)
//
// uihost resolves dist/<app>.{js,pak} relative to the POCKETJS checkout by
// default, which is vendor/pocketjs here — so instead of copying artifacts
// in, this script passes our dist/main.js + dist/main.pak EXPLICITLY via
// uihost's --js/--pak flags (--app then only names the window title and the
// eval source label). Extra args are forwarded to uihost verbatim.
//
// Input map (from uihost): arrows = D-pad, Z/Enter = CROSS, A = SQUARE,
// S = TRIANGLE, Q/W = L/R triggers; analog nub I/K/J/L. For this viewer:
// nub/d-pad pan, R/L zoom, TRIANGLE/SQUARE page, CROSS fit.

import { $ } from "bun";

const repo = new URL("..", import.meta.url).pathname;
const pocket3d = `${repo}vendor/pocketjs/pocket3d/`;

console.log("pocket-figma desktop: building the JS bundle");
await $`bun vendor/pocketjs/scripts/build.ts app/main.tsx --outdir=dist`.cwd(repo);

const extra = Bun.argv.slice(2);
console.log("pocket-figma desktop: cargo run -p uihost");
await $`cargo run --release -p uihost -- --app pocket-figma --js ${repo}dist/main.js --pak ${repo}dist/main.pak ${extra}`.cwd(
  pocket3d,
);
