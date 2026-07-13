// Figma viewer — pans and zooms the Paper Wireframe Kit (Community) file,
// baked at compile time (gen-assets.ts) into TILESET pyramids streamed by the
// DeepZoom engine component. Controls:
//
//   analog nub / d-pad  pan          R / L trigger  zoom in / out
//   TRIANGLE / SQUARE   next / prev page            CROSS  fit page
//
// Everything on screen is a baked tile: vectors, component instances, masks,
// the Patrick Hand glyphs and the photos were all rasterized from the .fig's
// own derived geometry — no Figma runtime, no fonts, no network.

import { createSignal } from "solid-js";
import {
  DeepZoom,
  Text,
  View,
  type DeepZoomView,
  type NodeMirror,
  type TileDoc,
} from "@pocketjs/framework/components";
import { BTN, touches } from "@pocketjs/framework/input";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import * as hot from "@pocketjs/framework/hot";
import { platform } from "@pocketjs/framework/platform";
import * as density1 from "./tiles.ts";
import * as density2 from "./tiles@2x.ts";
import { TouchGestureRecognizer } from "./touch-gesture.ts";

const TILE_ASSETS = {
  [density1.RASTER_DENSITY]: density1,
  [density2.RASTER_DENSITY]: density2,
} as const;

const tileAssets = TILE_ASSETS[platform.pixelRatio >= 2 ? 2 : 1];
const { PAGES, TILE } = tileAssets;

/** Baked manifest -> the DeepZoom engine's document shape. */
const DOCS: TileDoc[] = PAGES.map((p) => ({
  name: p.name,
  w: p.w,
  h: p.h,
  bg: p.bg,
  tile: TILE,
  levels: p.levels,
}));

interface FigmaViewTelemetry {
  zoom: number;
  minZoom: number;
  centerX: number;
  centerY: number;
}

const viewTelemetry: FigmaViewTelemetry = {
  zoom: 0,
  minZoom: 0,
  centerX: 0,
  centerY: 0,
};
(
  globalThis as typeof globalThis & {
    __pocketFigmaView?: FigmaViewTelemetry;
  }
).__pocketFigmaView = viewTelemetry;

export default function App() {
  const [page, setPage] = createSignal(0);
  const touchGesture = new TouchGestureRecognizer();
  let zoomLabel: NodeMirror | undefined;

  const changePage = (delta: number): void => {
    touchGesture.reset();
    setPage((p) => (p + DOCS.length + delta) % DOCS.length);
  };
  onButtonPress(BTN.TRIANGLE, () => changePage(1));
  onButtonPress(BTN.SQUARE, () => changePage(-1));

  const gestureSource = () => {
    const gesture = touchGesture.step(touches());
    if (gesture.kind === "idle") return null;
    if (gesture.kind === "inertia") {
      return { panX: gesture.panX, panY: gesture.panY };
    }
    return {
      panX: gesture.panX,
      panY: gesture.panY,
      zoomFactor: gesture.zoomFactor,
      anchorX: gesture.anchorX,
      anchorY: gesture.anchorY,
    };
  };

  // Per-frame zoom readout bypasses Solid (hot.text gates on change) — a
  // trigger-held zoom would otherwise re-render the HUD 60x/s on QuickJS.
  const onView = (v: DeepZoomView): void => {
    viewTelemetry.zoom = v.zoom;
    viewTelemetry.minZoom = v.minZoom;
    viewTelemetry.centerX = v.centerX;
    viewTelemetry.centerY = v.centerY;
    hot.text(zoomLabel, `${Math.round(v.zoom * 100)}%`);
  };

  return (
    <View class="w-full h-full bg-slate-900">
      <DeepZoom
        doc={DOCS[page()]}
        gestureSource={gestureSource}
        onView={onView}
      />
      {/* HUD bar; the zoom readout lives in a FIXED cell so hot.text updates
          never relayout (see src/hot.ts rules) */}
      <View class="absolute left-0 right-0 bottom-0 h-7 flex-row items-center justify-between bg-slate-900 px-2">
        <Text class="text-xs text-white">{DOCS[page()].name}</Text>
        <Text class="text-xs text-slate-400">
          {"TRI/SQR page  R/L zoom  X fit"}
        </Text>
        <Text
          class="text-xs text-white"
          style={{ width: 44, height: 14 }}
          nodeRef={(n) => (zoomLabel = n)}
        >
          100%
        </Text>
      </View>
    </View>
  );
}
