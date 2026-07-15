import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { MissionControlRibbon } from './mission-control-ribbon/mission-control-ribbon';
import { MissionControlView } from './mission-control-view/mission-control-view';

/**
 * Describes the Mission Control feature's contribution to the application shell: the view mounted for
 * the Mission Control tab and its contextual ribbon. The status strip is hidden — the view is a
 * management surface, not a document. The shell renders both by looking the `mission-control` type up
 * in the feature registry, with no hard-coded knowledge of the feature.
 */
const missionControlFeature: FeatureDescriptor = {
  type: 'mission-control',
  view: MissionControlView,
  ribbon: MissionControlRibbon,
  chrome: { status: false },
};

/**
 * Registers the Mission Control feature with the application shell. The renderer composition root adds
 * this to its provider list — the one place that enumerates features.
 * @returns Returns the environment providers that stand the Mission Control feature up at start-up.
 */
export function provideMissionControlFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([provideFeature(missionControlFeature)]);
}
