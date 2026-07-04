import { bootstrapApplication } from '@angular/platform-browser';
import { config } from './config';
import { Root } from './root/root';

/**
 * Resolves whether the heavier UI effects should be reduced for the first paint, mirroring the
 * Display service so the document is correct before Angular bootstraps (avoiding a squircle-to-round
 * flash). The persisted "modern UI features" choice wins when explicit; otherwise the GPU-derived
 * recommendation from the main process decides. Best-effort: any read/parse failure falls back to
 * the recommendation. Once Angular boots, the Display service takes over and keeps this in sync.
 * @returns Returns true when corners and decorative effects should be reduced.
 */
function shouldReduceEffects(): boolean {
  const recommend: boolean = window.host?.display?.gpuRendering?.recommendReducedEffects ?? false;
  try {
    const raw: string | null = localStorage.getItem('settings');
    const choice: unknown = raw
      ? (JSON.parse(raw) as { appearance?: { modernUiFeatures?: unknown } }).appearance
          ?.modernUiFeatures
      : undefined;
    if (choice === 'on') {
      return false;
    }
    if (choice === 'off') {
      return true;
    }
  } catch {
    // Settings are unreadable or malformed; fall back to the GPU recommendation below.
  }
  return recommend;
}

// Apply the resolved display policy before bootstrap so it is in place for the first paint. The main
// process flags GPUs that corrupt squircle corner masks (notably the Intel UHD 630); the same
// low-power GPUs also struggle with the welcome screen's animated, blurred, blended orbs and frosted
// backdrop. When reduced, corners fall back to plain rounded rectangles
// (`:root[data-corners='round']` in shared/angular/styles/_variables.scss) and the heavy decorative effects are
// softened (`:host-context([data-reduced-gpu])` in welcome-screen.scss). No-op outside Electron,
// where `window.host` is undefined and no override is persisted.
if (shouldReduceEffects()) {
  const root: HTMLElement = document.documentElement;
  root.setAttribute('data-corners', 'round');
  root.setAttribute('data-reduced-gpu', 'true');
}

bootstrapApplication(Root, config).catch((error: unknown): void => {
  console.error(error);
});
