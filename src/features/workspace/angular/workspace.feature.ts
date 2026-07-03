import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { DirectoryRibbon } from './directory-ribbon/directory-ribbon';
import { DirectoryView } from './directory-view/directory-view';

/**
 * Describes the workspace feature's contribution to the application shell: the directory view mounted
 * for each directory (workspace) tab and its contextual ribbon. The shell renders both by looking the
 * `directory` type up in the feature registry, with no hard-coded knowledge of the feature.
 */
const workspaceFeature: FeatureDescriptor = {
  type: 'directory',
  view: DirectoryView,
  ribbon: DirectoryRibbon,
};

/**
 * Registers the workspace feature with the application shell. The renderer composition root adds this
 * to its provider list — the one place that enumerates features. Each directory tab is a full IDE
 * instance composing the shared dock, editors, and git layers; the feature owns no electron or api
 * surface of its own.
 * @returns Returns the environment providers that stand the workspace feature up at start-up.
 */
export function provideWorkspaceFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([provideFeature(workspaceFeature)]);
}
