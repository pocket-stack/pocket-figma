// Build Pocket Figma as a native PS Vita VPK: shared JS bundle + pak ->
// the reusable PocketJS Vita runtime -> dist/vita/PocketFigma.vpk.
//
//   bun scripts/vita.ts             # debug VPK
//   bun scripts/vita.ts --release   # optimized VPK
//   bun scripts/vita.ts --capture   # scripted input + RGBA dumps for E2E

import { $ } from "bun";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import {
  compilePocketTarget,
  nativePlanEnvironment,
} from "./pocket-plan.ts";

const repo = new URL("..", import.meta.url).pathname;
const home = process.env.HOME ?? "";
const crate = `${repo}crates/pocket-figma-vita/`;
const argv = Bun.argv.slice(2);
const target = "vita";

const release = argv.includes("-r") || argv.includes("--release");
const features: string[] = [];
if (argv.includes("--capture")) features.push("capture");
if (argv.includes("--bench")) features.push("bench");

const vitaSdkCandidates = [
  process.env.VITASDK,
  `${home}/vitasdk`,
  "/usr/local/vitasdk",
].filter((path): path is string => Boolean(path));
const vitaSdk = vitaSdkCandidates.find((path) =>
  existsSync(`${path}/bin/vita-pack-vpk`),
);
if (!vitaSdk) {
  console.error(
    `VitaSDK not found (set VITASDK; checked ${vitaSdkCandidates.join(", ")})`,
  );
  process.exit(1);
}

const rustup = Bun.which("rustup") ?? `${home}/.cargo/bin/rustup`;
if (!existsSync(rustup) || !Bun.which("cargo-vita")) {
  console.error(
    "rustup/cargo-vita not found (install with `rustup run nightly cargo install cargo-vita`)",
  );
  process.exit(1);
}

console.log("pocket-figma vita: resolving, checking, and compiling pocket.json");
const plan = await compilePocketTarget(target);

const profile = release ? "release" : "debug";
const cargoArgs: string[] = [];
if (release) cargoArgs.push("--release");
if (features.length) cargoArgs.push(`--features=${features.join(",")}`);
const toolchain =
  process.env.POCKET_FIGMA_VITA_RUST_TOOLCHAIN ?? "nightly-2026-05-28";
const env = {
  ...process.env,
  VITASDK: vitaSdk,
  // cargo-vita probes `rustc` through PATH. Put rustup's shims before the
  // Homebrew stable toolchain or it will reject the build as non-nightly.
  PATH: `${vitaSdk}/bin:${home}/.cargo/bin:${process.env.PATH ?? ""}`,
  // QuickJS is compiled as C while cargo targets Vita. Explicit tools prevent
  // macOS `ar`/`cc` from producing host-format objects in the target archive.
  TARGET_AR: "arm-vita-eabi-ar",
  AR_armv7_sony_vita_newlibeabihf: "arm-vita-eabi-ar",
  TARGET_CC: "arm-vita-eabi-gcc",
  CC_armv7_sony_vita_newlibeabihf: "arm-vita-eabi-gcc",
  TARGET_CXX: "arm-vita-eabi-g++",
  CXX_armv7_sony_vita_newlibeabihf: "arm-vita-eabi-g++",
  ...nativePlanEnvironment(plan),
};

console.log(`pocket-figma vita: cargo vita (${profile})`);
await $`${rustup} run ${toolchain} cargo vita build vpk -- ${cargoArgs}`
  .cwd(crate)
  .env(env);

const targetDirectory = `${crate}target/armv7-sony-vita-newlibeabihf/${profile}/`;
const artifact = [
  `${targetDirectory}pocket-figma-vita.vpk`,
  `${targetDirectory}pocket_figma_vita.vpk`,
].find(existsSync);
if (!artifact) {
  console.error(
    `cargo-vita completed but no Pocket Figma VPK was found under ${targetDirectory}`,
  );
  process.exit(1);
}

const packaged = `${repo}dist/vita/PocketFigma.vpk`;
mkdirSync(`${repo}dist/vita`, { recursive: true });
cpSync(artifact, packaged);
console.log(`output: ${packaged}`);
