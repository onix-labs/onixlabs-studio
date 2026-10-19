import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { WORKSPACE_KEYBINDINGS } from './workspace-keybindings';
import { DirectoryHost } from './directory-host/directory-host';
import { DirectoryRibbon } from './directory-ribbon/directory-ribbon';
import { DirectoryStatusStrip } from './directory-status/directory-status-strip';
import { AgentRunConfigurationCapabilities } from './agent-run-configuration-capabilities/agent-run-configuration-capabilities';
import { FindRouter } from '@shared/angular/services/find-router/find-router';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { ReferencesRouter } from '@shared/angular/services/references/references-router';
import { WorkspaceFind } from './workspace-find/workspace-find';
import { WorkspaceReferences } from './workspace-references/workspace-references';

/**
 * Describes the workspace feature's contribution to the application shell: the directory view mounted
 * for each directory (workspace) tab and its contextual ribbon. The shell renders both by looking the
 * `directory` type up in the feature registry, with no hard-coded knowledge of the feature.
 */
const workspaceFeature: FeatureDescriptor = {
  type: 'directory',
  // The host decides what the tab is: a single workspace view, or a worktree container hosting one
  // kept-alive sub-view per checkout.
  view: DirectoryHost,
  ribbon: DirectoryRibbon,
  // Mounted through the ACTIVE sub-view's injector, so a container tab reports the selected checkout.
  status: DirectoryStatusStrip,
};

/**
 * Registers the workspace feature with the application shell. The renderer composition root adds this
 * to its provider list — the one place that enumerates features. Each directory tab is a full IDE
 * instance composing the shared dock, editors, and git layers; the feature owns no electron or api
 * surface of its own. It also eagerly instantiates the agent's run-configuration capabilities so they
 * are available to the AI runtime whenever an agent authors run configurations, and hands the shared
 * find router the workspace's find seam, so an editor's ⌘F reaches the active workspace's Search panel
 * without the router importing the feature (#1007) — and the references router its references seam, so
 * Find All References and a Go to Definition with several answers reach its References panel (#1014).
 * @returns Returns the environment providers that stand the workspace feature up at start-up.
 */
export function provideWorkspaceFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(workspaceFeature),
    provideKeybindingCatalogue(WORKSPACE_KEYBINDINGS),
    provideAppInitializer((): void => {
      inject(AgentRunConfigurationCapabilities);
      inject(FindRouter).useWorkspace(inject(WorkspaceFind));
      const references: WorkspaceReferences = inject(WorkspaceReferences);
      inject(ReferencesRouter).useWorkspace(references);
      // A Go to Definition or a listed reference in another file opens it in the ACTIVE workspace's
      // well (#1012, #1014), through the opener that view registered. Not the FileOpener resolved
      // here: that is the application-wide one, whose dock no view renders, so the file it opened
      // never showed an editor to go to.
      inject(EditorNavigation).useFileOpener((path: string): Promise<boolean> =>
        references.open(path),
      );
    }),
  ]);
}
