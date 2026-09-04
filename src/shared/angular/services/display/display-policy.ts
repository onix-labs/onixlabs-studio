import type { DisplayStartup, GraphicsAcceleration } from '@shared/api/host';

// The graphics-acceleration policy, as plain functions over plain data. It lives apart from the
// Display service because two callers need it and only one of them can afford Angular: the Display
// service, and the pre-bootstrap snippet in `shared/app/main.ts` that applies the policy to the
// document before the first paint (so the UI never flashes squircles on a machine that renders them
// poorly). Importing the service there would pull `@angular/core` into that path; importing these
// does not.

/**
 * Identifies a graphics-acceleration level with the automatic mode already resolved, so it names an
 * actual rendering policy rather than a choice.
 */
export type ResolvedGraphicsAcceleration = Exclude<GraphicsAcceleration, 'auto'>;

/**
 * Resolves a graphics-acceleration choice against the GPU-derived recommendation from the main
 * process. Only `auto` resolves; every other level is already an answer.
 * @param level The chosen graphics-acceleration level.
 * @param recommendReducedEffects Whether the active GPU is flagged as rendering the heavier effects poorly.
 * @returns Returns the level to actually apply.
 */
export function resolveGraphicsAcceleration(
  level: GraphicsAcceleration,
  recommendReducedEffects: boolean,
): ResolvedGraphicsAcceleration {
  if (level !== 'auto') return level;
  return recommendReducedEffects ? 'limited' : 'full';
}

/**
 * Resolves the level the interface should actually be drawn at right now, clamping the chosen level
 * to what the running process can afford.
 *
 * Hardware acceleration is fixed for the life of the process, so a user who raises the level while
 * running unaccelerated has chosen something this process cannot honour: the modern features are the
 * most expensive thing on screen to draw, and paying for them in software costs a CPU core for a look
 * the machine is not delivering. The choice is kept and takes effect on relaunch — which is what the
 * restart prompt is for — but nothing draws above the ceiling until then.
 * @param level The chosen graphics-acceleration level.
 * @param recommendReducedEffects Whether the active GPU is flagged as rendering the heavier effects poorly.
 * @param hardwareAccelerationEnabled Whether hardware acceleration was applied for this launch.
 * @returns Returns the level to draw at.
 */
export function renderGraphicsAcceleration(
  level: GraphicsAcceleration,
  recommendReducedEffects: boolean,
  hardwareAccelerationEnabled: boolean,
): ResolvedGraphicsAcceleration {
  if (!hardwareAccelerationEnabled) return 'off';
  return resolveGraphicsAcceleration(level, recommendReducedEffects);
}

/**
 * Determines whether a level wants GPU hardware acceleration. Every level except `off` does,
 * including `auto` — the automatic mode chooses how much of the GPU to lean on, never whether to use
 * one at all.
 * @param level The graphics-acceleration level.
 * @returns Returns true when hardware acceleration should be enabled.
 */
export function wantsHardwareAcceleration(level: GraphicsAcceleration): boolean {
  return level !== 'off';
}

/**
 * Reads the graphics-acceleration level from the startup snapshot, migrating the pre-merge settings
 * when nothing has been persisted under the merged key yet.
 *
 * MIGRATION SHIM. Before the merge the same policy was spread across three settings, two of which
 * lived in the renderer's settings store. The main process can read neither, so it reports null and
 * this reconstructs the level from `localStorage` on the renderer side:
 *
 * | Hardware acceleration | Modern UI features | Level     |
 * | :-------------------- | :----------------- | :-------- |
 * | off                   | (any)              | `off`     |
 * | on                    | `off`              | `limited` |
 * | on                    | `on`               | `full`    |
 * | on                    | `auto` or absent   | `auto`    |
 *
 * The merge is lossy in one direction: a user who had the modern features off but a workspace
 * texture on lands on `limited`, which suppresses the texture. The explicit effects choice wins,
 * because it is the one they made deliberately; the texture value itself is left untouched and
 * returns if they move to `full`. Delete this once installations predating the merge are gone.
 * @param startup The display startup snapshot, or undefined outside Electron.
 * @returns Returns the persisted level, the migrated level, or `auto` when neither is available.
 */
export function startupGraphicsAcceleration(
  startup: DisplayStartup | undefined,
): GraphicsAcceleration {
  const persisted: GraphicsAcceleration | null | undefined = startup?.graphicsAcceleration;
  if (persisted != null) return persisted;
  if (startup !== undefined && !startup.hardwareAccelerationEnabled) return 'off';

  try {
    const raw: string | null = localStorage.getItem('settings');
    const choice: unknown = raw
      ? (JSON.parse(raw) as { appearance?: { modernUiFeatures?: unknown } }).appearance
          ?.modernUiFeatures
      : undefined;

    if (choice === 'on') return 'full';
    if (choice === 'off') return 'limited';
  } catch {
    // Settings are unreadable or malformed; the automatic mode is the honest fallback.
  }

  return 'auto';
}
