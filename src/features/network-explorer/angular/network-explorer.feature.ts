import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { NetworkExplorerRibbon } from './network-explorer-ribbon/network-explorer-ribbon';
import { NetworkExplorerView } from './network-explorer-view/network-explorer-view';

/**
 * Describes the Network Explorer's contribution to the shell: a dock-hosting tab with the machine's
 * Interfaces, the Connections made over them and a well for what is watched, and its ribbon.
 * Contributed through the lazy `featureContributions` seam, exactly as the API and Database Explorers
 * are.
 */
export const descriptor: FeatureDescriptor = {
  type: 'network-explorer',
  view: NetworkExplorerView,
  ribbon: NetworkExplorerRibbon,
};
