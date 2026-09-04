import { bootstrapApplication } from '@angular/platform-browser';
import { LogChannel } from '@shared/api/log-channels';
import type { DisplayStartup } from '@shared/api/host';
import {
  renderGraphicsAcceleration,
  startupGraphicsAcceleration,
} from '@shared/angular/services/display/display-policy';
import { config } from './config';
import { warmIconFonts } from './icon-fonts';
import { Root } from './root/root';

/**
 * Resolves whether the heavier UI effects should be reduced for the first paint, mirroring the
 * Display service so the document is correct before Angular bootstraps (avoiding a squircle-to-round
 * flash). Anything below the full graphics-acceleration level reduces them. The policy itself lives
 * in `display-policy.ts`, shared with the Display service rather than restated here, so the two can
 * never disagree — which is the whole point of running it twice. Once Angular boots, the Display
 * service takes over and keeps this in sync.
 * @returns Returns true when corners and decorative effects should be reduced.
 */
function shouldReduceEffects(): boolean {
  const startup: DisplayStartup | undefined = window.host?.display;
  const level: string = renderGraphicsAcceleration(
    startupGraphicsAcceleration(startup),
    startup?.gpuRendering?.recommendReducedEffects ?? false,
    startup?.hardwareAccelerationEnabled ?? true,
  );
  return level !== 'full';
}

// Apply the resolved display policy before bootstrap so it is in place for the first paint. The main
// process flags GPUs that corrupt squircle corner masks (notably the Intel UHD 630); the same
// low-power GPUs also struggle with the heavier decorative effects. When reduced, corners fall back
// to plain rounded rectangles (`:root[data-corners='round']`) and the frosted backdrops are dropped
// (`:root[data-reduced-gpu='true']`) — both in shared/angular/styles/_variables.scss. No-op outside
// Electron, where `window.host` is undefined and no override is persisted.
if (shouldReduceEffects()) {
  const root: HTMLElement = document.documentElement;
  root.setAttribute('data-corners', 'round');
  root.setAttribute('data-reduced-gpu', 'true');
}

// Started before bootstrap so the six icon weights download alongside it, rather than being fetched
// the first time a glyph is painted — which is when the first tab opens. See `icon-fonts.ts`.
warmIconFonts();

bootstrapApplication(Root, config).catch((error: unknown): void => {
  // The forwarder may not have installed if bootstrap failed this early, so send the record straight
  // over the bridge as well as to the console (for DevTools).
  window.bridge?.send(LogChannel.Append, {
    severity: 'error',
    source: 'bootstrap',
    message: `Application failed to bootstrap: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  });
  console.error(error);
});
