import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { ApiExplorerRibbon } from './api-explorer-ribbon/api-explorer-ribbon';
import { ApiExplorerStatus } from './api-explorer-status/api-explorer-status';
import { ApiExplorerView } from './api-explorer-view/api-explorer-view';

/**
 * Describes the API Explorer feature's contribution to the application shell: a tab for building and
 * sending HTTP requests, its contextual ribbon, and its status strip. Contributed through the lazy
 * `featureContributions` seam (#388), so it lands in its own code-split chunk and the shell renders it
 * without being compiled against it.
 *
 * Unlike the other tool views, this one is a dock host: its body is the shared dock framework, given a
 * blueprint naming the API Explorer, the API well, History, the environment editor and the agent. The
 * shell needs to know none of that — it mounts the view and the ribbon exactly as it does for the
 * Containers or Model Manager tabs.
 */
export const descriptor: FeatureDescriptor = {
  type: 'api-explorer',
  view: ApiExplorerView,
  ribbon: ApiExplorerRibbon,
  status: ApiExplorerStatus,
};
