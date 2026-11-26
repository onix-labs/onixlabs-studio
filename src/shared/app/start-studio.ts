import { bootstrapApplication } from '@angular/platform-browser';
import { LogChannel } from '@shared/api/log-channels';
import { openDesignCanvas } from './canvas/canvas-entry';
import { config } from './config';
import { Root } from './root/root';

/**
 * Bootstraps Studio.
 */
function bootstrapStudio(): void {
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
}

/**
 * Starts Studio, or the conversation canvas in its place.
 *
 * Everything with text in it is reached from here, and this module is only imported once the
 * interface's language has loaded (see `main.ts`), so no module translates before its translations
 * exist.
 * @returns Returns a promise that settles once the page has been handed to one or the other.
 */
export async function startStudio(): Promise<void> {
  // The conversation canvas (#855) takes the page instead when it is loaded with `?canvas`, in
  // development builds only; a production build never starts it.
  if (!(await openDesignCanvas())) {
    bootstrapStudio();
  }
}
