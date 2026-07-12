// Native PS Vita E2E: compile deterministic controller tracks into the VPK,
// run the installed app in an isolated Vita3K VitaFS, then byte-compare its
// deterministic 960x544 captures with the application goldens.
//
// Vita3K currently faults on macOS while tearing down some homebrew processes.
// The app therefore writes a `done` marker after its last capture; this driver
// treats that marker as completion and terminates the emulator itself.
//
//   bun run e2e:vita            # compare committed goldens
//   UPDATE=1 bun run e2e:vita   # intentionally re-baseline
//
// Environment:
//   VITA3K                path to the Vita3K executable
//   VITA3K_PREF           isolated VitaFS root (defaults below out/)
//   VITA3K_CONFIG_SOURCE  source config.yml to clone without modifying it
//   VITA_E2E_CASE          run one named journey while diagnosing a failure


import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { encodePNG } from "../vendor/pocketjs/test/png.ts";

const repo = new URL("..", import.meta.url).pathname;
const home = process.env.HOME ?? "";
const update = process.env.UPDATE === "1";
const goldenDir = `${repo}test/goldens-vita`;
const outDir = `${repo}out/e2e-vita`;
const fsRoot = resolve(process.env.VITA3K_PREF ?? `${outDir}/vita3k-fs`);
const configDir = `${outDir}/vita3k-config`;
const configFile = `${configDir}/config.yml`;
const titleId = "PFIG00001";
const appDir = `${fsRoot}/ux0/app/${titleId}`;
const captureDir = `${fsRoot}/ux0/data/pocket-figma-vita/cap`;
const doneFile = `${captureDir}/done`;
const width = 960;
const height = 544;
const frameBytes = width * height * 4;

interface Spec {
  name: string;
  /** `frame:mask:lx:ly` states, held until the next entry. */
  input: string;
  captureFrame: number;
}

const R = 0x0200;
const TRIANGLE = 0x1000;
const SPECS: Spec[] = [
  {
    name: "fit",
    input: "0:0:128:128",
    captureFrame: 47,
  },
  {
    name: "zoom",
    input: `0:0:128:128,20:${R}:128:128,40:0:128:128`,
    captureFrame: 63,
  },
  {
    name: "zoom-pan",
    input: `0:0:128:128,20:${R}:128:128,40:0:128:128,44:0:255:128,64:0:128:128`,
    captureFrame: 79,
  },
  {
    name: "next-page",
    input: `0:0:128:128,16:${TRIANGLE}:128:128,17:0:128:128`,
    captureFrame: 71,
  },
];
const requestedCase = process.env.VITA_E2E_CASE;
const specs = requestedCase
  ? SPECS.filter((spec) => spec.name === requestedCase)
  : SPECS;
if (specs.length === 0) {
  console.error(
    `Unknown VITA_E2E_CASE=${requestedCase}; expected ${SPECS.map((spec) => spec.name).join(", ")}`,
  );
  process.exit(1);
}

const vita3kCandidates = [
  process.env.VITA3K,
  "/Applications/Vita3K.app/Contents/MacOS/Vita3K",
  `${home}/Applications/Vita3K.app/Contents/MacOS/Vita3K`,
].filter((path): path is string => Boolean(path));
const vita3k = vita3kCandidates.find(existsSync);
if (!vita3k) {
  console.error(
    `Vita3K not found (set VITA3K; checked ${vita3kCandidates.join(", ")})`,
  );
  process.exit(1);
}

const configCandidates = [
  process.env.VITA3K_CONFIG_SOURCE,
  `${home}/Library/Application Support/Vita3K/Vita3K/config.yml`,
  `${home}/Library/Application Support/Vita3K/config.yml`,
].filter((path): path is string => Boolean(path));
const configSource = configCandidates.find(existsSync);
if (!configSource) {
  console.error(
    "Vita3K config.yml not found; launch Vita3K once or set VITA3K_CONFIG_SOURCE",
  );
  process.exit(1);
}

const globalConfigCandidates = [
  `${home}/Library/Application Support/Vita3K/Vita3K/config.yml`,
  `${home}/Library/Application Support/Vita3K/config.yml`,
];
const globalConfig = globalConfigCandidates.find(existsSync);
if (!globalConfig) {
  console.error("Vita3K global config.yml not found; launch Vita3K once");
  process.exit(1);
}

function configPath(source: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m").exec(source)?.[1];
  if (!value) return undefined;
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

const globalFsRoot = resolve(
  configPath(readFileSync(globalConfig, "utf8"), "pref-path") ??
    `${home}/Library/Application Support/Vita3K/Vita3K/fs`,
);
const globalCliPlaceholder = `${globalFsRoot}/ux0/app/${titleId}`;

mkdirSync(goldenDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

function setConfigScalar(source: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(`^${escaped}:.*$`, "m");
  if (line.test(source)) return source.replace(line, `${key}: ${value}`);
  const end = /\n\.\.\.\s*$/;
  if (end.test(source)) return source.replace(end, `\n${key}: ${value}\n...\n`);
  return `${source.trimEnd()}\n${key}: ${value}\n`;
}

async function prepareVita3k(): Promise<void> {
  mkdirSync(configDir, { recursive: true });
  for (const mount of [
    "grw0",
    "host0",
    "imc0",
    "os0",
    "pd0",
    "sa0",
    "sd0",
    "tm0",
    "ud0",
    "uma0/data",
    "ur0",
    "ux0/app",
    "ux0/data",
    "ux0/music",
    "ux0/picture",
    "ux0/theme",
    "ux0/user/00",
    "ux0/video",
    "vd0/network",
    "vd0/registry",
    "vs0",
    "xmc0",
  ]) {
    mkdirSync(`${fsRoot}/${mount}`, { recursive: true });
  }
  let config = readFileSync(configSource!, "utf8");
  for (const [key, value] of [
    ["initial-setup", "false"],
    ["validation-layer", "false"],
    ["backend-renderer", "Vulkan"],
    ["screen-filter", "Nearest"],
    ["v-sync", "false"],
    ["show-compile-shaders", "false"],
    ["modules-mode", "2"],
    ["log-level", "3"],
    ["pref-path", JSON.stringify(fsRoot)],
    ["discord-rich-presence", "false"],
    ["show-welcome", "false"],
    ["warn-missing-firmware", "false"],
    ["check-for-updates-mode", "0"],
  ] as const) {
    config = setConfigScalar(config, key, value);
  }
  await Bun.write(configFile, config);

  // Vita3K creates these on a normal first run. Seeding the minimal user files
  // keeps the isolated, firmware-free homebrew VitaFS deterministic in CI.
  await Bun.write(
    `${fsRoot}/ux0/user/time.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<time><user id="00"><app last-time-used="0" time-used="0">${titleId}</app></user></time>\n`,
  );
  await Bun.write(
    `${fsRoot}/ux0/user/00/user.xml`,
    '<?xml version="1.0" encoding="utf-8"?>\n<user id="00" name="Vita3K"><theme use-background="true"><content-id>default</content-id></theme><start-screen type="default"><path></path></start-screen><backgrounds /></user>\n',
  );
}

function installVpk(vpk: string): void {
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  const result = Bun.spawnSync(["unzip", "-oq", vpk, "-d", appDir], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`VPK extraction failed: ${result.stderr.toString()}`);
  }
  for (const required of ["eboot.bin", "sce_sys/param.sfo"]) {
    if (!existsSync(`${appDir}/${required}`)) {
      throw new Error(`VPK is missing ${required}`);
    }
  }
}

function captureFiles(): string[] {
  if (!existsSync(captureDir)) return [];
  return readdirSync(captureDir)
    .filter((name) => /^f\d{4}\.rgba$/.test(name))
    .sort();
}

class Vita3kLaunchError extends Error {
  constructor(
    message: string,
    readonly guestStarted: boolean,
  ) {
    super(message);
    this.name = "Vita3kLaunchError";
  }
}

async function launchAndWait(): Promise<string> {
  // Vita3K validates `-r` against its global VitaFS before parsing the custom
  // config. An empty, temporary directory is sufficient for that CLI check;
  // the actual self/SFO are read from the isolated VitaFS after config load.
  const removePlaceholder = !existsSync(globalCliPlaceholder);
  if (removePlaceholder) mkdirSync(globalCliPlaceholder, { recursive: true });

  try {
    const child = Bun.spawn(
      [
        vita3k!,
        "--keep-config",
        "--load-config",
        "--config-location",
        configFile,
        "-r",
        titleId,
      ],
      {
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      },
    );
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    const deadline = Date.now() + 180_000;
    const errorFile = `${captureDir}/error.txt`;
    while (
      Date.now() < deadline &&
      !existsSync(doneFile) &&
      !existsSync(errorFile)
    ) {
      const exited = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(100).then(() => false),
      ]);
      if (exited) break;
    }

    const completed = existsSync(doneFile);
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([child.exited, Bun.sleep(5_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
    const logs = `${await stdout}\n${await stderr}`.slice(-12_000);
    const files = captureFiles();
    if (!completed || files.length !== 1) {
      const stage = existsSync(`${captureDir}/stage.txt`)
        ? readFileSync(`${captureDir}/stage.txt`, "utf8")
        : "not-started";
      const hasAppError = existsSync(errorFile);
      const error = hasAppError
        ? readFileSync(errorFile, "utf8")
        : "none";
      throw new Vita3kLaunchError(
        `Vita3K completion=${completed}, captures=${files.length}/1, stage=${stage}, error=${error} under ${captureDir}\n${logs}`,
        stage !== "not-started",
      );
    }
    return files[0]!;
  } finally {
    if (removePlaceholder) {
      rmSync(globalCliPlaceholder, { recursive: true, force: true });
    }
  }
}

async function launchWithStartupRetry(): Promise<string> {
  try {
    return await launchAndWait();
  } catch (error) {
    if (!(error instanceof Vita3kLaunchError) || error.guestStarted) throw error;
    console.warn("Vita3K did not enter the guest; retrying once");
    rmSync(captureDir, { recursive: true, force: true });
    mkdirSync(captureDir, { recursive: true });
    await Bun.sleep(1_000);
    return launchAndWait();
  }
}

function distinctPixels(rgba: Uint8Array): number {
  const pixels = new Uint32Array(
    rgba.buffer,
    rgba.byteOffset,
    rgba.byteLength / 4,
  );
  const seen = new Set<number>();
  for (const pixel of pixels) {
    seen.add(pixel);
    if (seen.size > 16) break;
  }
  return seen.size;
}

function assertExactFullscreen2x(rgba: Uint8Array): void {
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const topLeft = (y * width + x) * 4;
      for (const offset of [topLeft + 4, topLeft + width * 4, topLeft + width * 4 + 4]) {
        for (let channel = 0; channel < 4; channel++) {
          if (rgba[topLeft + channel] !== rgba[offset + channel]) {
            throw new Error(`pixel block at (${x}, ${y}) is not exact 2x`);
          }
        }
      }
    }
  }
}

await prepareVita3k();

let failures = 0;
const captures = new Map<string, Uint8Array>();
for (const spec of specs) {
  console.log(`\n## ${spec.name} (capture frame ${spec.captureFrame})`);
  const build = Bun.spawnSync(
    ["bun", "scripts/vita.ts", "--release", "--capture"],
    {
      cwd: repo,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        POCKET_FIGMA_VITA_CAPTURE_INPUT: spec.input,
        POCKET_FIGMA_VITA_CAP_START: String(spec.captureFrame),
        POCKET_FIGMA_VITA_CAP_N: "1",
      },
    },
  );
  if (build.exitCode !== 0) {
    console.error(`FAIL ${spec.name}: capture VPK build failed`);
    failures++;
    continue;
  }

  rmSync(captureDir, { recursive: true, force: true });
  mkdirSync(captureDir, { recursive: true });
  try {
    installVpk(`${repo}dist/vita/PocketFigma.vpk`);
  } catch (error) {
    console.error(`FAIL ${spec.name}: ${error}`);
    failures++;
    continue;
  }

  let capture: string;
  try {
    capture = await launchWithStartupRetry();
  } catch (error) {
    console.error(`FAIL ${spec.name}: ${error}`);
    failures++;
    continue;
  }

  const rawFile = readFileSync(`${captureDir}/${capture}`);
  const raw = new Uint8Array(
    rawFile.buffer,
    rawFile.byteOffset,
    rawFile.byteLength,
  );
  if (raw.byteLength !== frameBytes) {
    console.error(
      `FAIL ${spec.name}: capture is ${raw.byteLength} bytes, expected ${frameBytes}`,
    );
    failures++;
    continue;
  }
  const colors = distinctPixels(raw);
  if (colors < 3) {
    console.error(`FAIL ${spec.name}: degenerate frame (${colors} colors)`);
    failures++;
    continue;
  }
  try {
    assertExactFullscreen2x(raw);
  } catch (error) {
    console.error(`FAIL ${spec.name}: framebuffer is not 960x544 exact 2x: ${error}`);
    failures++;
    continue;
  }
  captures.set(spec.name, raw.slice());

  const png = encodePNG(raw, width, height);
  const out = `${outDir}/${spec.name}.png`;
  await Bun.write(out, png);
  const golden = `${goldenDir}/${spec.name}.png`;
  if (update) {
    await Bun.write(golden, png);
    console.log(`baseline ${spec.name} written`);
  } else if (!existsSync(golden)) {
    console.error(
      `FAIL ${spec.name}: golden missing (run UPDATE=1 bun run e2e:vita)`,
    );
    failures++;
  } else if (readFileSync(golden).equals(png)) {
    console.log(`ok ${spec.name} (960x544 exact 2x, byte-exact)`);
  } else {
    await Bun.write(`${goldenDir}/${spec.name}.actual.png`, png);
    console.error(
      `FAIL ${spec.name}: differs from golden (wrote ${spec.name}.actual.png)`,
    );
    failures++;
  }
}

for (const [baselineName, name] of [
  ["fit", "zoom"],
  ["zoom", "zoom-pan"],
  ["fit", "next-page"],
] as const) {
  const baseline = captures.get(baselineName);
  const candidate = captures.get(name);
  if (baseline && candidate && Buffer.from(baseline).equals(candidate)) {
    console.error(
      `FAIL ${name}: native controller journey did not change the ${baselineName} framebuffer`,
    );
    failures++;
  }
}

if (update) {
  const version = Bun.spawnSync([vita3k, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stamp = `${version.stdout.toString()}${version.stderr.toString()}`.trim();
  if (stamp) await Bun.write(`${goldenDir}/VITA3K-VERSION.txt`, `${stamp}\n`);
}

if (failures) {
  console.error(`\nVITA E2E FAILED (${failures})`);
  process.exit(1);
}
console.log("\nVITA E2E OK");
