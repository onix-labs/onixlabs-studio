import { LogChannel } from '@shared/api/log-channels';
import type { DisplayStartup } from '@shared/api/host';
import {
  cornersAttribute,
  renderGraphicsAcceleration,
  ResolvedGraphicsAcceleration,
  startupGraphicsAcceleration,
} from '@shared/angular/services/display/display-policy';
import { trackDevicePixel } from '@shared/angular/services/display/device-pixel';
import { warmIconFonts } from './icon-fonts';
import { loadLanguage } from './locale/load-language';

/**
 * Resolves the graphics level for the first paint, mirroring the Display service so the document is
 * correct before Angular bootstraps (avoiding a squircle-to-round flash). Anything below the full
 * graphics-acceleration level reduces the heavier effects. The policy itself lives in
 * `display-policy.ts`, shared with the Display service rather than restated here, so the two can
 * never disagree — which is the whole point of running it twice. Once Angular boots, the Display
 * service takes over and keeps this in sync.
 * @returns Returns the resolved graphics-acceleration level.
 */
function startupLevel(): ResolvedGraphicsAcceleration {
  const startup: DisplayStartup | undefined = window.host?.display;
  return renderGraphicsAcceleration(
    startupGraphicsAcceleration(startup),
    startup?.gpuRendering?.recommendReducedEffects ?? false,
    startup?.hardwareAccelerationEnabled ?? true,
  );
}

// Apply the resolved display policy before bootstrap so it is in place for the first paint. The main
// process flags GPUs that corrupt squircle corner masks (notably the Intel UHD 630); the same
// low-power GPUs also struggle with the heavier decorative effects. When reduced, corners fall back
// to plain rounded rectangles (`:root[data-corners='round']`) and the frosted backdrops are dropped
// (`:root[data-reduced-gpu='true']`) — both in shared/angular/styles/_variables.scss. No-op outside
// Electron, where `window.host` is undefined and no override is persisted.
// The corners follow the Corner Style setting, mirrored to the main process so it is known here.
{
  const root: HTMLElement = document.documentElement;
  const level: ResolvedGraphicsAcceleration = startupLevel();
  const corners: string | null = cornersAttribute(
    window.host?.startupSettings.cornerStyle ?? 'automatic',
    level,
  );
  if (corners !== null) {
    root.setAttribute('data-corners', corners);
  }
  if (level !== 'full') {
    root.setAttribute('data-reduced-gpu', 'true');
  }
}

// Each platform dresses the window differently (see `WindowManager.chrome`): macOS insets its traffic
// lights over the leading end of the top strip, Windows draws its caption buttons over the trailing
// end, and Linux keeps the native title bar. The strips that share that space style themselves by
// `:root[data-platform]`, so it is stamped before the first paint.
document.documentElement.setAttribute('data-platform', window.host?.platform ?? 'browser');

// The tab feet are drawn in whole device pixels (`--hairline`), which only script can measure.
trackDevicePixel(window);

// Started before bootstrap so the six icon weights download alongside it, rather than being fetched
// the first time a glyph is painted — which is when the first tab opens. See `icon-fonts.ts`.
warmIconFonts();

/**
 * Starts Studio in the interface's language.
 *
 * Only what has no text is imported above. Studio's text is translated as its modules are first read,
 * so the language is loaded first and the rest of Studio is imported after it, from `start-studio.ts`.
 * @returns Returns a promise that settles once Studio has started.
 */
async function start(): Promise<void> {
  try {
    await loadLanguage(window.host?.startupSettings.language ?? 'system', navigator.languages);
  } catch (error: unknown) {
    // A missing or broken translation is no reason not to start: the interface reads in English.
    window.bridge?.send(LogChannel.Append, {
      severity: 'error',
      source: 'bootstrap',
      message: `The interface language failed to load: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const { startStudio }: typeof import('./start-studio') = await import('./start-studio');
  await startStudio();
}

void start();
