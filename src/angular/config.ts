import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { Display } from '@shared/angular/services/display/display';
import { Lifecycle } from '@shared/angular/services/lifecycle/lifecycle';
import { Theme } from '@shared/angular/services/theme/theme';
import { provideAgentFeature } from '@features/agent/angular/agent.feature';
import { provideCodeFeature } from '@features/code/angular/code.feature';
import { provideMarkdownFeature } from '@features/markdown/angular/markdown.feature';
import { provideRepositoryFeature } from '@features/repository/angular/repository.feature';
import { provideSettingsFeature } from '@features/settings/angular/settings.feature';
import { provideTerminalFeature } from '@features/terminal/angular/terminal.feature';
import { provideWorkspaceFeature } from '@features/workspace/angular/workspace.feature';

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
    // Stand up the terminal feature: register its view + ribbon with the shell and eagerly register
    // its agent terminal capabilities. The one line that enumerates the terminal feature here.
    provideTerminalFeature(),
    // Stand up the agent feature: register its chat view + ribbon with the shell.
    provideAgentFeature(),
    // Stand up the code feature: register its tab view, ribbon, and the lean document-well panel.
    provideCodeFeature(),
    // Stand up the markdown feature: register its tab view, ribbon, and the lean document-well panel.
    provideMarkdownFeature(),
    // Stand up the repository feature: register its source-control view + ribbon with the shell.
    provideRepositoryFeature(),
    // Stand up the workspace feature: register its directory (IDE) view + ribbon with the shell.
    provideWorkspaceFeature(),
    // Stand up the settings feature: register its full-bleed view (chrome opts out of ribbon+status).
    provideSettingsFeature(),
    // Instantiate the lifecycle service at start-up so it answers the main process's window-close
    // requests (confirming/saving unsaved work) for the whole session.
    provideAppInitializer((): void => {
      inject(Lifecycle);
    }),
  ],
};
