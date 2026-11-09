import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { DATABASE_EXPLORER_KEYBINDINGS } from './database-explorer-keybindings';
import { DatabaseExplorerRibbon } from './database-explorer-ribbon/database-explorer-ribbon';
import { DatabaseExplorerStatus } from './database-explorer-status/database-explorer-status';
import { DatabaseExplorerView } from './database-explorer-view/database-explorer-view';

/**
 * Describes the Database Explorer's contribution to the shell: a dock-hosting tab with an
 * Object Explorer, a well of queries and a Properties panel, its ribbon and its status strip. Contributed
 * through the lazy `featureContributions` seam, exactly as the API Explorer is.
 */
export const descriptor: FeatureDescriptor = {
  type: 'database-explorer',
  view: DatabaseExplorerView,
  ribbon: DatabaseExplorerRibbon,
  status: DatabaseExplorerStatus,
  keybindings: DATABASE_EXPLORER_KEYBINDINGS,
};
