import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { PluginManagerRibbon } from './plugin-manager-ribbon/plugin-manager-ribbon';
import { PluginManagerView } from './plugin-manager-view/plugin-manager-view';

/**
 * Describes the Plugin Manager feature's contribution to the application shell: a singleton tool view
 * listing what Studio can install and what is installed, and its contextual ribbon. Contributed through
 * the lazy `featureContributions` seam (#388), so it lands in its own code-split chunk and the shell
 * renders it without being compiled against it.
 *
 * The view owns *installation*. Choosing between two installed plugins that provide the same thing is
 * Settings' job — the same split the AI Model Manager draws against Settings > AI > Providers.
 */
export const descriptor: FeatureDescriptor = {
  type: 'plugin-manager',
  view: PluginManagerView,
  ribbon: PluginManagerRibbon,
};
