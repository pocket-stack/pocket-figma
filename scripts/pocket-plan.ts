import { $ } from "bun";
import {
  verifyBuildPlanHash,
  type ResolvedBuildPlan,
} from "@pocketjs/framework/manifest";

export const projectRoot = new URL("..", import.meta.url).pathname;
export const outputDirectory = `${projectRoot}dist`;

/** Resolve, target-check, and compile the app through PocketJS's v2 contract. */
export async function compilePocketTarget(
  target: string,
): Promise<ResolvedBuildPlan> {
  const manifestPath = `${projectRoot}pocket.json`;
  const planPath = `${projectRoot}.pocket/${target}/plan.json`;

  await $`bun vendor/pocketjs/scripts/pocket.ts compile --target ${target} --manifest ${manifestPath} --project-root ${projectRoot} --outdir ${outputDirectory}`
    .cwd(projectRoot);

  const plan = (await Bun.file(planPath).json()) as ResolvedBuildPlan;
  if (!verifyBuildPlanHash(plan) || plan.target.id !== target) {
    throw new Error(`invalid ${target} ResolvedBuildPlan at ${planPath}`);
  }
  return plan;
}

/** Environment shared by the app crate and its framework-native dependency. */
export function nativePlanEnvironment(
  plan: ResolvedBuildPlan,
): Readonly<Record<string, string>> {
  return {
    POCKETJS_APP_OUTPUT: plan.app.output,
    // This project owns the final PSP/Vita bins and embeds the app in their
    // build.rs files. Framework runtime dependencies publish HostOps only.
    POCKETJS_EMBED_APP: "0",
    POCKETJS_OUTPUT_DIR: outputDirectory,
    POCKETJS_TARGET: plan.target.id,
    POCKETJS_HOST_ABI: String(plan.target.hostAbi),
    POCKETJS_CONTRACT_HASH: plan.contractHash,
    POCKETJS_LOGICAL_WIDTH: String(plan.viewport.logical[0]),
    POCKETJS_LOGICAL_HEIGHT: String(plan.viewport.logical[1]),
    POCKETJS_PHYSICAL_WIDTH: String(plan.viewport.physical[0]),
    POCKETJS_PHYSICAL_HEIGHT: String(plan.viewport.physical[1]),
    POCKETJS_PRESENTATION: plan.viewport.presentation,
  };
}
