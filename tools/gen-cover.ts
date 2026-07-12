// tools/gen-cover.ts — render the XMB cover art.
//
//   bun tools/gen-cover.ts [--fig=<path to .fig>]
//
// No hand-drawn assets. The committed Vita copies are quantized through
// ImageMagick to the palette PNG format required by LiveArea:
//
//   art/ICON0.png  144x80   the Figma logo mark — the app is a Figma viewer,
//                           so the XMB tile says Figma, not the kit it happens
//                           to ship. Five path fills, drawn right here.
//   art/PIC1.png   480x272  the Welcome page "Cover" frame — the "Wireframe
//                           PAPER KIT made by METHOD" hero — center-cropped
//                           to cover the PSP screen, rendered from the .fig by
//                           the same compile-time rasterizer (fig.ts) that
//                           bakes the tiles.
//   art/vita/ICON0.png
//                  128x128  the square PS Vita bubble icon, rendered from the
//                           same vector Figma mark as the PSP XMB icon.
//   crates/pocket-figma-vita/static/sce_sys/livearea/contents/
//                           840x500 cover background + 280x158 startup image.
//
// The PSP pair is copied into crates/pocket-figma-psp/assets/ (the relative
// paths Psp.toml hands to pack-pbp); the Vita icon is copied into its VPK's
// static/sce_sys directory. All are COMMITTED like the tiles, so console
// builds work without the .fig. The packagers embed the PNG bytes verbatim.

import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createCanvas, ImageData, Path2D, type Canvas } from "@napi-rs/canvas";
import {
  openFig,
  renderRegion,
  type FigDoc,
  type RenderedRegion,
} from "./fig.ts";

const REPO = new URL("../", import.meta.url).pathname;
const ART = REPO + "art/";
const VITA_ART = ART + "vita/";
const VITA_ASSETS = REPO + "crates/pocket-figma-vita/static/sce_sys/";
const ASSETS = REPO + "crates/pocket-figma-psp/assets/";

const ICON_W = 144;
const ICON_H = 80;
const VITA_ICON_W = 128;
const VITA_ICON_H = 128;
const PIC_W = 480;
const PIC_H = 272;

let figPath = homedir() + "/Downloads/Paper Wireframe Kit (Community).fig";
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--fig=")) figPath = a.slice("--fig=".length);
}
if (!existsSync(figPath)) {
  console.error(`gen-cover: ${figPath} not found — pass --fig=<path to .fig>`);
  console.error("(The .fig is not committed; the rendered art under art/ is.)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Node lookup — walk the decoded tree instead of hardcoding page coords, so a
// re-export of the kit (or a coordinate nudge upstream) can't silently crop
// the wrong region. The kit's frames are axis-aligned; accumulating the
// translation column is exact here (rotation would need the full 2x3).
// ---------------------------------------------------------------------------

interface AbsBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// deno-lint-ignore no-explicit-any
const gid = (g: any): string => `${g.sessionID}:${g.localID}`;

function findAbs(
  doc: FigDoc,
  pageIndex: number,
  type: string,
  name: string,
  maxDepth: number,
): AbsBox[] {
  const out: AbsBox[] = [];
  // deno-lint-ignore no-explicit-any
  const walk = (n: any, ax: number, ay: number, depth: number): void => {
    const x = ax + (n.transform?.m02 ?? 0);
    const y = ay + (n.transform?.m12 ?? 0);
    if (n.type === type && n.name === name) {
      out.push({ x, y, w: n.size?.x ?? 0, h: n.size?.y ?? 0 });
    }
    if (depth >= maxDepth) return;
    for (const k of doc.childrenOf.get(gid(n.guid)) ?? [])
      walk(k, x, y, depth + 1);
  };
  for (const k of doc.childrenOf.get(gid(doc.pageNodes[pageIndex].guid)) ?? [])
    walk(k, 0, 0, 0);
  return out;
}

/** Render a WxH page-coords window centered on (cx, cy) at `scale`. */
function renderCentered(
  doc: FigDoc,
  pageIndex: number,
  cx: number,
  cy: number,
  outW: number,
  outH: number,
  scale: number,
): RenderedRegion {
  const w = outW / scale;
  const h = outH / scale;
  return renderRegion(doc, pageIndex, cx - w / 2, cy - h / 2, w, h, scale);
}

function savePng(name: string, canvas: Canvas): void {
  const png = canvas.toBuffer("image/png");
  mkdirSync(ART, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });
  writeFileSync(ART + name, png);
  writeFileSync(ASSETS + name, png);
  console.log(
    `gen-cover: art/${name} (${canvas.width}x${canvas.height}, ${png.length} bytes) -> also ${ASSETS.slice(REPO.length)}${name}`,
  );
}

function saveVitaPng(name: string, canvas: Canvas): void {
  const png = quantizeVitaPng(canvas);
  mkdirSync(VITA_ART, { recursive: true });
  mkdirSync(VITA_ASSETS, { recursive: true });
  writeFileSync(VITA_ART + name, png);
  writeFileSync(VITA_ASSETS + name.toLowerCase(), png);
  console.log(
    `gen-cover: art/vita/${name} (${canvas.width}x${canvas.height}, ${png.length} bytes) -> also ${VITA_ASSETS.slice(REPO.length)}${name.toLowerCase()}`,
  );
}

function quantizeVitaPng(canvas: Canvas): Buffer {
  const magick = Bun.which("magick");
  if (!magick) {
    throw new Error(
      "gen-cover: ImageMagick `magick` is required for PS Vita palette PNGs",
    );
  }
  const result = Bun.spawnSync(
    [magick, "png:-", "-alpha", "off", "-colors", "256", "png8:-"],
    {
      stdin: canvas.toBuffer("image/png"),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `gen-cover: Vita PNG quantization failed: ${result.stderr.toString()}`,
    );
  }
  return Buffer.from(result.stdout);
}

function saveVitaAsset(path: string, canvas: Canvas): void {
  const png = quantizeVitaPng(canvas);
  const output = VITA_ASSETS + path;
  mkdirSync(output.slice(0, output.lastIndexOf("/")), { recursive: true });
  writeFileSync(output, png);
  console.log(
    `gen-cover: ${output.slice(REPO.length)} (${canvas.width}x${canvas.height}, ${png.length} bytes)`,
  );
}

function writePng(
  name: string,
  r: RenderedRegion,
  outW: number,
  outH: number,
): void {
  if (r.width !== outW || r.height !== outH) {
    console.error(
      `gen-cover: ${name} rendered ${r.width}x${r.height}, expected ${outW}x${outH}`,
    );
    process.exit(1);
  }
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(
    new ImageData(
      new Uint8ClampedArray(r.rgba.buffer, r.rgba.byteOffset, r.rgba.length),
      outW,
      outH,
    ),
    0,
    0,
  );
  savePng(name, canvas);
}

function writeVitaAsset(
  path: string,
  r: RenderedRegion,
  outW: number,
  outH: number,
): void {
  if (r.width !== outW || r.height !== outH) {
    throw new Error(
      `gen-cover: ${path} rendered ${r.width}x${r.height}, expected ${outW}x${outH}`,
    );
  }
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(
    new ImageData(
      new Uint8ClampedArray(r.rgba.buffer, r.rgba.byteOffset, r.rgba.length),
      outW,
      outH,
    ),
    0,
    0,
  );
  saveVitaAsset(path, canvas);
}

// ---------------------------------------------------------------------------
// ICON0 — the Figma logo mark on a dark tile, the same composition as Figma's
// own app icon. The mark is five path fills in a 200x300 box (the canonical
// brand SVG geometry); we scale it to 70% of the tile height and center it.
// ---------------------------------------------------------------------------

const FIGMA_MARK: ReadonlyArray<readonly [color: string, path: string]> = [
  ["#f24e1e", "M0 50C0 22.4 22.4 0 50 0h50v100H50C22.4 100 0 77.6 0 50z"],
  ["#ff7262", "M100 0h50c27.6 0 50 22.4 50 50s-22.4 50-50 50h-50V0z"],
  ["#a259ff", "M0 150c0-27.6 22.4-50 50-50h50v100H50c-27.6 0-50-22.4-50-50z"],
  [
    "#1abcfe",
    "M100 150c0-27.6 22.4-50 50-50s50 22.4 50 50-22.4 50-50 50-50-22.4-50-50z",
  ],
  [
    "#0acf83",
    "M50 300c27.6 0 50-22.4 50-50v-50H50c-27.6 0-50 22.4-50 50s22.4 50 50 50z",
  ],
];

function renderIcon(outW: number, outH: number): Canvas {
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, outW, outH);
  const markH = outH * 0.7;
  const scale = markH / 300;
  ctx.save();
  ctx.translate((outW - 200 * scale) / 2, (outH - markH) / 2);
  ctx.scale(scale, scale);
  for (const [color, d] of FIGMA_MARK) {
    ctx.fillStyle = color;
    ctx.fill(new Path2D(d));
  }
  ctx.restore();
  return canvas;
}

// ---------------------------------------------------------------------------

const doc = await openFig(figPath);
const pageIndex = doc.pages.findIndex((p) => p.name.includes("Welcome"));
if (pageIndex < 0) {
  console.error("gen-cover: no Welcome page in this .fig");
  process.exit(1);
}

// ICON0 — the Figma logo mark. This is the tile the XMB shows in the game
// list; it should say what the app IS (a Figma viewer), not which kit it
// happens to ship.
savePng("ICON0.png", renderIcon(ICON_W, ICON_H));
saveVitaPng("ICON0.png", renderIcon(VITA_ICON_W, VITA_ICON_H));

// PIC1 — the 1920x960 "Cover" hero, scaled to COVER 480x272 (16:9 -> 30:17
// center-crops a little off each side).
const covers = findAbs(doc, pageIndex, "FRAME", "Cover", 0); // top-level only
if (covers.length === 0) {
  console.error("gen-cover: no top-level 'Cover' frame on the Welcome page");
  process.exit(1);
}
const cover = covers[0];
const picScale = Math.max(PIC_W / cover.w, PIC_H / cover.h);
writePng(
  "PIC1.png",
  renderCentered(
    doc,
    pageIndex,
    cover.x + cover.w / 2,
    cover.y + cover.h / 2,
    PIC_W,
    PIC_H,
    picScale,
  ),
  PIC_W,
  PIC_H,
);

// Vita LiveArea: a complete installable bubble, using the same cover and logo
// instead of generic SDK artwork. template.xml is committed beside these.
const vitaBgW = 840;
const vitaBgH = 500;
const vitaBgScale = Math.max(vitaBgW / cover.w, vitaBgH / cover.h);
writeVitaAsset(
  "livearea/contents/bg.png",
  renderCentered(
    doc,
    pageIndex,
    cover.x + cover.w / 2,
    cover.y + cover.h / 2,
    vitaBgW,
    vitaBgH,
    vitaBgScale,
  ),
  vitaBgW,
  vitaBgH,
);
saveVitaAsset("livearea/contents/startup.png", renderIcon(280, 158));
