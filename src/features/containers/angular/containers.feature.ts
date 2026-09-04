import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { ContainersRibbon } from './containers-ribbon/containers-ribbon';
import { ContainersView } from './containers-view/containers-view';

/**
 * Describes the Containers feature's contribution to the application shell: the tab view that lists
 * and controls the engine's containers/images, and its contextual ribbon. Unlike the eagerly-wired
 * features, this module is dynamic-imported by the `featureContributions` manifest, so it lands in its
 * own code-split chunk and the shell renders it without ever being compiled against it directly — the
 * north-star of the plugin seam (#388).
 */
export const descriptor: FeatureDescriptor = {
  type: 'containers',
  view: ContainersView,
  ribbon: ContainersRibbon,
};
