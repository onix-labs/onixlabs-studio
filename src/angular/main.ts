import { bootstrapApplication } from '@angular/platform-browser';
import { config } from './config';
import { Root } from './components/root/root';

// Apply the weak-GPU display policy before bootstrap so it is in place for the first paint. The main
// process flags GPUs that corrupt squircle corner masks (notably the Intel UHD 630); the same
// low-power GPUs also struggle with the welcome screen's animated, blurred, blended orbs and frosted
// backdrop. Both degradations derive from that one signal: corners fall back to plain rounded
// rectangles (`:root[data-corners='round']` in styles/_variables.scss), and the heavy decorative
// effects are reduced (`:host-context([data-reduced-gpu])` in welcome-screen.scss). No-op outside
// Electron, where `window.studio` is undefined.
if (window.studio?.forceRoundCorners === true) {
  const root: HTMLElement = document.documentElement;
  root.setAttribute('data-corners', 'round');
  root.setAttribute('data-reduced-gpu', 'true');
}

bootstrapApplication(Root, config).catch((error: unknown): void => {
  console.error(error);
});
