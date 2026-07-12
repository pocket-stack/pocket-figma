// Deterministic Pocket Figma application golden.
//
// The app keeps PocketJS's 480x272 logical coordinate space on every target.
// PS Vita presents that framebuffer as an exact 2x fullscreen image at
// 960x544, so the committed goldens are encoded at the physical Vita size.
// This harness boots the real app bundle + pak against PocketJS's wasm core,
// drives the same button-mask/analog frame contract as the native hosts, and
// byte-compares the resulting 2x framebuffer.
//
//   bun run golden          # compare committed goldens
//   bun run golden:update   # regenerate, then inspect every PNG

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createWasmUi } from "../vendor/pocketjs/host-web/wasm-ops.js";
import { BTN, SCREEN_H, SCREEN_W } from "../vendor/pocketjs/spec/spec.ts";
import { encodePNG } from "../vendor/pocketjs/test/png.ts";

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
}

interface GoldenSpec {
  name: string;
  frames: number;
  input?: (frame: number) => FrameInput;
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

function ensureArtifacts(): void {
  // Always rebuild the application: silently testing a stale bundle is worse
  // than the few seconds this deterministic build costs.
  run(["bun", "run", "build"]);
  run(["bun", "vendor/pocketjs/scripts/wasm.ts"]);
}

function scaleFullscreen2x(logical: Uint8Array): Uint8Array {
  if (logical.byteLength !== LOGICAL_W * LOGICAL_H * 4) {
    throw new Error(
      `expected ${LOGICAL_W}x${LOGICAL_H} RGBA framebuffer, got ${logical.byteLength} bytes`,
    );
  }
  const physical = new Uint8Array(VITA_W * VITA_H * 4);
  for (let y = 0; y < LOGICAL_H; y++) {
    for (let x = 0; x < LOGICAL_W; x++) {
      const src = (y * LOGICAL_W + x) * 4;
      for (let dy = 0; dy < VITA_SCALE; dy++) {
        const row = ((y * VITA_SCALE + dy) * VITA_W + x * VITA_SCALE) * 4;
        for (let dx = 0; dx < VITA_SCALE; dx++) {
          physical.set(logical.subarray(src, src + 4), row + dx * 4);
        }
      }
    }
  }
  return physical;
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

async function render(
  spec: GoldenSpec,
  wasmBytes: ArrayBuffer,
  js: string,
  pak: ArrayBuffer,
) {
  const wasm = await createWasmUi(wasmBytes);
  const globals = globalThis as Record<string, unknown>;
  globals.ui = wasm.ops;
  globals.__pak = pak;
  globals.frame = undefined;

  try {
    (0, eval)(js);
    const frame = globals.frame as
      ((buttons: number, analog?: number) => void) | undefined;
    if (typeof frame !== "function") {
      throw new Error("bundle did not install globalThis.frame");
    }
    for (let index = 0; index < spec.frames; index++) {
      const input = spec.input?.(index) ?? {};
      frame(input.buttons ?? 0, input.analog ?? ANALOG_CENTER);
      wasm.tick();
    }
    return scaleFullscreen2x(wasm.render().slice());
  } finally {
    delete globals.ui;
    delete globals.__pak;
    globals.frame = undefined;
  }
}

ensureArtifacts();
mkdirSync(GOLDENS, { recursive: true });

const wasmBytes = await Bun.file(WASM).arrayBuffer();
const js = await Bun.file(`${DIST}main.js`).text();
const pak = await Bun.file(`${DIST}main.pak`).arrayBuffer();

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

// These journeys exercise different controller paths; identical results
// would mean that the Vita input contract no longer reaches DeepZoom/app UI.
for (const [baselineName, name] of [
  ["fit", "zoom"],
  ["zoom", "zoom-pan"],
  ["fit", "next-page"],
] as const) {
  const baseline = frames.get(baselineName);
  const candidate = frames.get(name);
  if (baseline && candidate && Buffer.from(baseline).equals(candidate)) {
    console.error(
      `FAIL  ${name}: controller journey did not change the ${baselineName} framebuffer`,
    );
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
