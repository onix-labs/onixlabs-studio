import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { CanvasRoot } from './canvas-root';

/**
 * Starts the design canvas in place of Studio (#855). Only the providers the cards need: they are
 * given their data, so none of Studio's services is started — no plugins, no settings writes.
 * @returns Resolves once the canvas has started.
 */
export async function bootstrapCanvas(): Promise<void> {
  document.title = 'Design canvas';
  document.documentElement.dataset['themeMode'] = 'dark';
  // The page carries Studio's root element; the canvas takes its place.
  document.querySelector('app-root')?.replaceWith(document.createElement('app-canvas-root'));
  await bootstrapApplication(CanvasRoot, {
    providers: [provideBrowserGlobalErrorListeners(), provideZonelessChangeDetection()],
  });
}
