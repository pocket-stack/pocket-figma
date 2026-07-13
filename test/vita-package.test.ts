import { describe, expect, test } from "bun:test";
import {
  resolveVitaPackageAssets,
  VITA_REQUIRED_SYSTEM_ASSETS,
} from "../vendor/pocketjs/scripts/vita-package.ts";

const root = new URL("..", import.meta.url).pathname;
const applicationAssets = `${root}crates/pocket-figma-vita/static`;

describe("Pocket Figma Vita package artwork", () => {
  test("overlays a complete validated LiveArea through PocketJS's resolver", () => {
    const assets = resolveVitaPackageAssets({ applicationAssets });
    const byDestination = new Map(assets.map((asset) => [asset.destination, asset.source]));
    for (const path of VITA_REQUIRED_SYSTEM_ASSETS) {
      expect(byDestination.get(path)).toBe(`${applicationAssets}/${path}`);
    }
  });
});
