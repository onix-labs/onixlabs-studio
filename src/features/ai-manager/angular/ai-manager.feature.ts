import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { AiManagerRibbon } from './ai-manager-ribbon/ai-manager-ribbon';
import { AiManagerStatusStrip } from './ai-manager-status/ai-manager-status-strip';
import { AiManagerView } from './ai-manager-view/ai-manager-view';

/**
 * Describes the AI Manager feature's contribution to the application shell (#948): a singleton tool
 * view for everything AI the user builds up and looks after — providers, local models, prompt
 * profiles and skills — and its contextual ribbon. Contributed through the lazy `featureContributions`
 * seam (#388), so it lands in its own code-split chunk and the shell renders it without being
 * compiled against it.
 *
 * The tab keeps its original `model-manager` type, from when it held only the models, so saved
 * layouts that name it still open it.
 */
export const descriptor: FeatureDescriptor = {
  type: 'model-manager',
  view: AiManagerView,
  ribbon: AiManagerRibbon,
  status: AiManagerStatusStrip,
};
