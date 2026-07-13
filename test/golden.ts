// Deterministic Pocket Figma application golden.
//
// The app keeps PocketJS's 480x272 logical coordinate space on every target,
// while PS Vita rasterizes that scene directly at 960x544 with density-2
// fonts, rounded masks and Figma tiles. This harness compiles the real Vita
// bundle + pak, boots them against PocketJS's wasm core at raster density 2,
// drives the same button-mask/analog frame contract as the native host, and
// byte-compares the resulting physical framebuffer.
//
//   bun run golden          # compare committed goldens
//   bun run golden:update   # regenerate, then inspect every PNG

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createWasmUi } from "../vendor/pocketjs/host-web/wasm-ops.js";
import { unpack } from "../vendor/pocketjs/compiler/pak.ts";
import { BTN, SCREEN_H, SCREEN_W } from "../vendor/pocketjs/spec/spec.ts";
import { encodePNG } from "../vendor/pocketjs/test/png.ts";
import { compilePocketTarget } from "../scripts/pocket-plan.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = `${ROOT}dist/`;
const WASM = `${ROOT}vendor/pocketjs/host-web/pocketjs.wasm`;
const GOLDENS = `${ROOT}test/goldens-vita/`;
const UPDATE = process.env.UPDATE === "1";

const LOGICAL_W = SCREEN_W;
const LOGICAL_H = SCREEN_H;
const VITA_SCALE = 2;
const VITA_W = LOGICAL_W * VITA_SCALE;
const VITA_H = LOGICAL_H * VITA_SCALE;
const ANALOG_CENTER = 0x8080;

interface FrameInput {
  buttons?: number;
  analog?: number;
  touches?: readonly number[];
}

interface GoldenSpec {
  name: string;
  frames: number;
  input?: (frame: number) => FrameInput;
}

function packTouch(id: number, x: number, y: number): number {
  return ((id & 0xff) << 18) | ((y & 0x1ff) << 9) | (x & 0x1ff);
}

function zoomThenTouchPan(frame: number): FrameInput {
  if (frame >= 20 && frame < 40) return { buttons: BTN.RTRIGGER };
  if (frame >= 44 && frame <= 50) {
    return { touches: [packTouch(1, 240 + (frame - 44) * 10, 136)] };
  }
  return {};
}

function pinch(frame: number): FrameInput {
  if (frame >= 20 && frame <= 30) {
    const spread = 40 + (frame - 20) * 4;
    return {
      touches: [
        packTouch(1, 240 - spread, 136),
        packTouch(2, 240 + spread, 136),
      ],
    };
  }
  return {};
}

const SPECS: GoldenSpec[] = [
  {
    name: "fit",
    frames: 48,
  },
  {
    name: "zoom",
    frames: 64,
    input(frame) {
      return frame >= 20 && frame < 40 ? { buttons: BTN.RTRIGGER } : {};
    },
  },
  {
    name: "zoom-pan",
    frames: 80,
    input(frame) {
      if (frame >= 20 && frame < 40) return { buttons: BTN.RTRIGGER };
      if (frame >= 44 && frame < 64) return { analog: 0xff80 };
      return {};
    },
  },
  {
    name: "next-page",
    frames: 72,
    input(frame) {
      return frame === 16 ? { buttons: BTN.TRIANGLE } : {};
    },
  },
  {
    name: "touch-pan-drag",
    frames: 51,
    input: zoomThenTouchPan,
  },
  {
    name: "touch-pan-inertia",
    frames: 71,
    input: zoomThenTouchPan,
  },
  {
    name: "touch-pinch",
    frames: 46,
    input: pinch,
  },
];

function run(command: string[]): void {
  const child = Bun.spawnSync(command, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (child.exitCode !== 0) {
    throw new Error(`command failed (${child.exitCode}): ${command.join(" ")}`);
  }
}

async function ensureArtifacts(): Promise<void> {
  // Always rebuild the application: silently testing a stale bundle is worse
  // than the few seconds this deterministic build costs.
  await compilePocketTarget("vita");
  run(["bun", "vendor/pocketjs/scripts/wasm.ts"]);
}

function distinctPixels(rgba: Uint8Array): number {
  const seen = new Set<number>();
  const pixels = new Uint32Array(
    rgba.buffer,
    rgba.byteOffset,
    rgba.byteLength / 4,
  );
  for (const pixel of pixels) {
    seen.add(pixel);
    if (seen.size > 16) break;
  }
  return seen.size;
}

function assertDensity2Tiles(pak: ArrayBuffer): void {
  const tiles = unpack(new Uint8Array(pak)).filter((entry) =>
    entry.key.startsWith("ui:tile.fig."),
  );
  if (tiles.length !== 20) {
    throw new Error(`expected 20 Figma tile pyramids, got ${tiles.length}`);
  }
  for (const tile of tiles) {
    const header = new DataView(
      tile.data.buffer,
      tile.data.byteOffset,
      tile.data.byteLength,
    );
    const width = header.getUint16(8, true);
    const height = header.getUint16(10, true);
    if (width !== 512 || height !== 512) {
      throw new Error(
        `${tile.key} selected ${width}x${height} tiles; expected density-2 512x512`,
      );
    }
  }
  console.log("PASS  assets (20/20 density-2 tile pyramids selected)");
}

async function render(
  spec: GoldenSpec,
  wasmBytes: ArrayBuffer,
  js: string,
  pak: ArrayBuffer,
) {
  const wasm = await createWasmUi(wasmBytes);
  wasm.init(VITA_SCALE);
  const globals = globalThis as Record<string, unknown>;
  globals.ui = wasm.ops;
  globals.__pak = pak;
  globals.frame = undefined;

  try {
    (0, eval)(js);
    const frame = globals.frame as
      ((
        buttons: number,
        analog?: number,
        touches?: readonly number[],
      ) => void) | undefined;
    if (typeof frame !== "function") {
      throw new Error("bundle did not install globalThis.frame");
    }
    for (let index = 0; index < spec.frames; index++) {
      const input = spec.input?.(index) ?? {};
      frame(
        input.buttons ?? 0,
        input.analog ?? ANALOG_CENTER,
        input.touches,
      );
      wasm.tick();
    }
    return wasm.renderScaled(VITA_SCALE).slice();
  } finally {
    delete globals.ui;
    delete globals.__pak;
    globals.frame = undefined;
  }
}

await ensureArtifacts();
mkdirSync(GOLDENS, { recursive: true });

const wasmBytes = await Bun.file(WASM).arrayBuffer();
const js = await Bun.file(`${DIST}main.js`).text();
const pak = await Bun.file(`${DIST}main.pak`).arrayBuffer();
assertDensity2Tiles(pak);

let passed = 0;
let failed = 0;
const frames = new Map<string, Uint8Array>();

for (const spec of SPECS) {
  try {
    const rgba = await render(spec, wasmBytes, js, pak);
    frames.set(spec.name, rgba);
    const distinct = distinctPixels(rgba);
    if (distinct < 3) {
      throw new Error(
        `degenerate framebuffer (${distinct} distinct pixel values)`,
      );
    }

    const png = encodePNG(rgba, VITA_W, VITA_H);
    const golden = `${GOLDENS}${spec.name}.png`;
    if (UPDATE) {
      writeFileSync(golden, png);
      console.log(`WROTE ${spec.name} (${VITA_W}x${VITA_H})`);
      passed++;
      continue;
    }
    if (!existsSync(golden)) {
      throw new Error("golden missing; run `bun run golden:update`");
    }
    const expected = readFileSync(golden);
    if (!expected.equals(png)) {
      writeFileSync(`${GOLDENS}${spec.name}.actual.png`, png);
      throw new Error(`PNG bytes differ (wrote ${spec.name}.actual.png)`);
    }
    console.log(`PASS  ${spec.name} (${VITA_W}x${VITA_H}, byte-exact)`);
    passed++;
  } catch (error) {
    console.error(`FAIL  ${spec.name}:`, error);
    failed++;
  }
}

// These journeys exercise independent controller and touch paths; identical
// results would mean that an input contract no longer reaches DeepZoom.
for (const [baselineName, name] of [
  ["fit", "zoom"],
  ["zoom", "zoom-pan"],
  ["fit", "next-page"],
  ["zoom", "touch-pan-drag"],
  ["touch-pan-drag", "touch-pan-inertia"],
  ["fit", "touch-pinch"],
] as const) {
  const baseline = frames.get(baselineName);
  const candidate = frames.get(name);
  if (baseline && candidate && Buffer.from(baseline).equals(candidate)) {
    console.error(
      `FAIL  ${name}: input journey did not change the ${baselineName} framebuffer`,
    );
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
