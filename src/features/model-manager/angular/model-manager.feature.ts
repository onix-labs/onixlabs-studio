import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { ModelManagerRibbon } from './model-manager-ribbon/model-manager-ribbon';
import { ModelManagerView } from './model-manager-view/model-manager-view';

/**
 * Describes the AI Model Manager feature's contribution to the application shell: a singleton tool
 * view for the local model lifecycle, and its contextual ribbon. Contributed through the lazy
 * `featureContributions` seam (#388), so it lands in its own code-split chunk and the shell renders it
 * without being compiled against it.
 *
 * The view owns the runtime and the weights — installing the runtime, starting and stopping its
 * server, and the models on disk. Endpoint configuration stays in Settings > AI > Providers, where
 * connections live (#254); this is the boundary the epic (#407) is built around.
 */
export const descriptor: FeatureDescriptor = {
  type: 'model-manager',
  view: ModelManagerView,
  ribbon: ModelManagerRibbon,
};
