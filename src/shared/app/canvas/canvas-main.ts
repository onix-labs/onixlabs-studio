import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { CanvasRoot } from './canvas-root';

/**
 * Starts the design canvas in place of Studio (#855), with none of Studio's start-up: specimens are
 * given their data. The few root services a whole conversation pulls in start on demand, and run
 * without Electron's bridge, so they reach nothing outside the page.
 * @returns Resolves once the canvas has started.
 */
export async function bootstrapCanvas(): Promise<void> {
  document.title = 'Design canvas';
  // The page carries Studio's root element; the canvas takes its place.
  document.querySelector('app-root')?.replaceWith(document.createElement('app-canvas-root'));
  await bootstrapApplication(CanvasRoot, {
    providers: [provideBrowserGlobalErrorListeners(), provideZonelessChangeDetection()],
  });
}
