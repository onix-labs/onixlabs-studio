import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { AgentEditorCapabilities } from './services/agent-editor-capabilities/agent-editor-capabilities';
import { AgentTerminalCapabilities } from './services/agent-terminal-capabilities/agent-terminal-capabilities';
import { Display } from './services/display/display';
import { Lifecycle } from './services/lifecycle/lifecycle';
import { Theme } from './services/theme/theme';

/**
 * Defines the application-wide Angular providers.
 */
export const config: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Instantiate the Theme service at start-up so the persisted mode and accent are applied to the
    // document before the first view renders.
    provideAppInitializer((): void => {
      inject(Theme);
    }),
    // Instantiate the Display service at start-up so the resolved modern-UI-features policy is applied
    // to the document (corners and decorative effects) before the first view renders.
    provideAppInitializer((): void => {
      inject(Display);
    }),
    // Instantiate the agent's in-app editor capabilities at start-up so they are registered with the
    // runtime whenever an agent runs.
    provideAppInitializer((): void => {
      inject(AgentEditorCapabilities);
    }),
    // Instantiate the agent's in-app terminal capabilities at start-up so they are registered with the
    // runtime whenever a terminal-surface agent runs.
    provideAppInitializer((): void => {
      inject(AgentTerminalCapabilities);
    }),
    // Instantiate the lifecycle service at start-up so it answers the main process's window-close
    // requests (confirming/saving unsaved work) for the whole session.
    provideAppInitializer((): void => {
      inject(Lifecycle);
    }),
  ],
};
