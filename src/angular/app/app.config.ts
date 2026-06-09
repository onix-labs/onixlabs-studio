import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

/**
 * Defines the application-wide Angular providers.
 */
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
