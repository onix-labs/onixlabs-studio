import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { ConsoleForwarder } from '@shared/angular/services/console-forwarder/console-forwarder';
import { Display } from '@shared/angular/services/display/display';
import { Theme } from '@shared/angular/services/theme/theme';

/**
 * Defines the providers for a pop-out window: the minimal set a secondary window needs to look and
 * log like the application, and nothing that belongs to the one main window.
 *
 * Deliberately absent — each would misbehave when run twice, once per window:
 * - `OpenWith` drains the main process's shared pending-open-paths queue, so a pop-out running it
 *   would steal files the operating system asked the IDE to open.
 * - `Lifecycle` answers the app-wide close-confirmation protocol, which has a single pending
 *   resolver in the main process; a second answerer would race the real one. Pop-outs hold no
 *   unsaved work and close plainly.
 * - The feature registrations and agent capability initializers construct `AiRuntime`, whose bridge
 *   subscriptions (including the in-app capability request handler) are the main window's alone.
 * - `Printing` styles the `@page` rule for document printing, which pop-outs do not do.
 */
export const popoutConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Instantiate the console forwarder first, so the pop-out's boot logs reach the main-process
    // logger like every other window's.
    provideAppInitializer((): void => {
      inject(ConsoleForwarder);
    }),
    // Theme and Display re-apply the persisted appearance (mode, accent, corner policy) to this
    // window's document before its first paint, exactly as the main window's boot does.
    provideAppInitializer((): void => {
      inject(Theme);
    }),
    provideAppInitializer((): void => {
      inject(Display);
    }),
  ],
};
