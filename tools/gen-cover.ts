// tools/gen-cover.ts — render the XMB cover art straight from the .fig.
//
//   bun tools/gen-cover.ts [--fig=<path to .fig>]
//
// No hand-drawn assets, no ImageMagick: the EBOOT's art IS the file it views,
// rendered by the same compile-time rasterizer (fig.ts) that bakes the tiles.
//
//   art/ICON0.png  144x80   the Paper Kit smiley-document logo (the "Icon
//                           Master" instance on the Welcome card), framed by
//                           the card's own whitespace
//   art/PIC1.png   480x272  the Welcome page "Cover" frame — the "Wireframe
//                           PAPER KIT made by METHOD" hero — center-cropped
//                           to cover the PSP screen
//
// Both are also copied into crates/pocket-figma-psp/assets/ (the relative
// paths Psp.toml hands to pack-pbp at `cargo psp` time) and COMMITTED, like
// the tiles: EBOOT builds must work without the .fig. pack-pbp embeds the
// PNG bytes verbatim, and both PPSSPP and the XMB accept RGBA PNGs, so the
// canvas encoder's output ships as-is.

import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { openFig, renderRegion, type FigDoc, type RenderedRegion } from "./fig.ts";

const REPO = new URL("../", import.meta.url).pathname;
const ART = REPO + "art/";
const ASSETS = REPO + "crates/pocket-figma-psp/assets/";

const ICON_W = 144;
const ICON_H = 80;
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
    for (const k of doc.childrenOf.get(gid(n.guid)) ?? []) walk(k, x, y, depth + 1);
  };
  for (const k of doc.childrenOf.get(gid(doc.pageNodes[pageIndex].guid)) ?? []) walk(k, 0, 0, 0);
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

function writePng(name: string, r: RenderedRegion, outW: number, outH: number): void {
  if (r.width !== outW || r.height !== outH) {
    console.error(`gen-cover: ${name} rendered ${r.width}x${r.height}, expected ${outW}x${outH}`);
    process.exit(1);
  }
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(r.rgba.buffer, r.rgba.byteOffset, r.rgba.length), outW, outH),
    0,
    0,
  );
  const png = canvas.toBuffer("image/png");
  mkdirSync(ART, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });
  writeFileSync(ART + name, png);
  writeFileSync(ASSETS + name, png);
  console.log(`gen-cover: art/${name} (${outW}x${outH}, ${png.length} bytes) -> also ${ASSETS.slice(REPO.length)}${name}`);
}

// ---------------------------------------------------------------------------

const doc = await openFig(figPath);
const pageIndex = doc.pages.findIndex((p) => p.name.includes("Welcome"));
if (pageIndex < 0) {
  console.error("gen-cover: no Welcome page in this .fig");
  process.exit(1);
}

// ICON0 — the smiley-document logo. Two "Icon Master" instances live on the
// Welcome page (the card's 219px one and the Cover frame's 127px one); take
// the largest. The icon fills 90% of the 80px height and the crop stays
// inside its host card, so the framing is the card's own paper white.
const icons = findAbs(doc, pageIndex, "INSTANCE", "Icon Master", 4);
if (icons.length === 0) {
  console.error("gen-cover: no 'Icon Master' instance on the Welcome page");
  process.exit(1);
}
const icon = icons.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
const iconScale = (ICON_H * 0.9) / icon.h;
writePng(
  "ICON0.png",
  renderCentered(doc, pageIndex, icon.x + icon.w / 2, icon.y + icon.h / 2, ICON_W, ICON_H, iconScale),
  ICON_W,
  ICON_H,
);

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
  renderCentered(doc, pageIndex, cover.x + cover.w / 2, cover.y + cover.h / 2, PIC_W, PIC_H, picScale),
  PIC_W,
  PIC_H,
);
