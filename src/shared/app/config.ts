import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { AgentRequestToasts } from '@shared/angular/services/notifications/agent-request-toasts';
import { ConsoleForwarder } from '@shared/angular/services/console-forwarder/console-forwarder';
import { Display } from '@shared/angular/services/display/display';
import { provideUnsavedWork } from '@shared/angular/services/unsaved-work/unsaved-work';
import { Documents } from '@shared/angular/services/documents/documents';
import { Lifecycle } from '@shared/angular/services/lifecycle/lifecycle';
import { OpenWith } from '@shared/angular/services/open-with/open-with';
import { Printing } from '@shared/angular/services/printing/printing';
import { Theme } from '@shared/angular/services/theme/theme';
import { FeatureDescriptor, FeatureRegistry } from '@shared/angular/services/feature-registry';
import { featureContributions } from '@shared/app/feature-contributions';
import { provideAgentFeature } from '@features/agent/angular/agent.feature';
import { provideBinaryFeature } from '@features/binary/angular/binary.feature';
import { provideCodeFeature } from '@features/code/angular/code.feature';
import { provideMarkdownFeature } from '@features/markdown/angular/markdown.feature';
import { provideMissionControlFeature } from '@features/mission-control/angular/mission-control.feature';
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
    // Instantiate the console forwarder first, so the earliest boot logs (including the other
    // initializers') reach the main-process logger. No-op outside Electron.
    provideAppInitializer((): void => {
      inject(ConsoleForwarder);
    }),
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
    // Instantiate the Printing service at start-up so the persisted print-margin choice drives the
    // `@page` rule before the first document is printed or exported.
    provideAppInitializer((): void => {
      inject(Printing);
    }),
    // Instantiate the agent-request toast bridge at start-up so pending agent asks surface as
    // toasts (when the setting is on) whichever panels happen to be mounted.
    provideAppInitializer((): void => {
      inject(AgentRequestToasts);
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
    // Stand up the binary feature: register its hex-editor tab view + ribbon with the shell.
    provideBinaryFeature(),
    // Stand up the repository feature: register its source-control view + ribbon with the shell.
    // Stand up the workspace feature: register its directory (IDE) view + ribbon with the shell.
    provideWorkspaceFeature(),
    // Stand up the Mission Control feature: register its all-agents view + ribbon with the shell.
    provideMissionControlFeature(),
    // Stand up the settings feature: register its full-bleed view (chrome opts out of ribbon+status).
    provideSettingsFeature(),
    // The one-time renderer lazy-load driver (the analog of the main process's contribution registry):
    // resolve every lazily-contributed feature and register its descriptor with the shell. A feature
    // added this way touches no shell component — only its own slice and the featureContributions
    // manifest. Registration is fire-and-forget: the FeatureRegistry is signal-backed, so the shell
    // lights the feature up when its chunk resolves, even after first paint.
    provideAppInitializer((): void => {
      const registry: FeatureRegistry = inject(FeatureRegistry);
      for (const load of featureContributions) {
        void load().then((module: { descriptor: FeatureDescriptor }): void =>
          registry.register(module.descriptor),
        );
      }
    }),
    // Contribute the text-document store to the unsaved-work seam the lifecycle walks at close
    // time; features with their own document models (binary) contribute themselves alongside.
    provideUnsavedWork(Documents),
    // Instantiate the lifecycle service at start-up so it answers the main process's window-close
    // requests (confirming/saving unsaved work) for the whole session.
    provideAppInitializer((): void => {
      inject(Lifecycle);
    }),
    // Instantiate the open-with service at start-up so files the operating system asks the app to
    // open (file-type associations) are drained and routed to the right editor tabs.
    provideAppInitializer((): void => {
      inject(OpenWith);
    }),
  ],
};
