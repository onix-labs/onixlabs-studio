import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { SourceControlRibbon } from './source-control-ribbon/source-control-ribbon';
import { SourceControlView } from './source-control-view/source-control-view';

/**
 * Describes the repository feature's contribution to the application shell: the source-control view
 * mounted for each source-control tab and its contextual ribbon. The shell renders both by looking
 * the `source-control` type up in the feature registry, with no hard-coded knowledge of the feature.
 */
const repositoryFeature: FeatureDescriptor = {
  type: 'source-control',
  view: SourceControlView,
  ribbon: SourceControlRibbon,
};

/**
 * Registers the repository feature with the application shell. The renderer composition root adds
 * this to its provider list — the one place that enumerates features. The feature composes the shared
 * dock, diff, and git-capability layers over the shared bridge; it owns no electron or api surface.
 * @returns Returns the environment providers that stand the repository feature up at start-up.
 */
export function provideRepositoryFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([provideFeature(repositoryFeature)]);
}
