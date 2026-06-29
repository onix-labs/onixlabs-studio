import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { AgentEditorCapabilities } from './services/agent-editor-capabilities/agent-editor-capabilities';
import { Display } from '@shared/angular/services/display/display';
import { Lifecycle } from './services/lifecycle/lifecycle';
import { Theme } from '@shared/angular/services/theme/theme';
import { provideAgentFeature } from '@features/agent/angular/agent.feature';
import { provideTerminalFeature } from '@features/terminal/angular/terminal.feature';

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
    // Stand up the terminal feature: register its view + ribbon with the shell and eagerly register
    // its agent terminal capabilities. The one line that enumerates the terminal feature here.
    provideTerminalFeature(),
    // Stand up the agent feature: register its chat view + ribbon with the shell.
    provideAgentFeature(),
    // Instantiate the lifecycle service at start-up so it answers the main process's window-close
    // requests (confirming/saving unsaved work) for the whole session.
    provideAppInitializer((): void => {
      inject(Lifecycle);
    }),
  ],
};
