import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { IMAGE_FILE_OPENER } from '@shared/angular/services/file-opener/image-file-opener';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { provideUnsavedWork } from '@shared/angular/services/unsaved-work/unsaved-work';
import { ImageDocuments } from './image-document/image-document';
import { IMAGE_KEYBINDINGS } from './image-keybindings';
import { ImageOpener } from './image-opener/image-opener';
import { ImageRibbon } from './image-ribbon/image-ribbon';
import { ImageStatusStrip } from './image-status/image-status-strip';
import { ImageView } from './image-view/image-view';

/**
 * Describes the image feature's contribution to the application shell: the view mounted for each
 * image tab, its contextual ribbon, and its status strip. An image opened into a workspace's well is
 * placed there by the file opener through {@link IMAGE_FILE_OPENER}, which registers the well panel
 * directly — the text document panel assumes every well document is text.
 */
const imageFeature: FeatureDescriptor = {
  type: 'image',
  view: ImageView,
  ribbon: ImageRibbon,
  status: ImageStatusStrip,
};

/**
 * Registers the image feature with the application shell. The renderer composition root adds this to
 * its provider list — the one place that enumerates features.
 * @returns Returns the environment providers that stand the image feature up at start-up.
 */
export function provideImageFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(imageFeature),
    provideKeybindingCatalogue(IMAGE_KEYBINDINGS),
    // Contribute the image opener to the shared FileOpener, and the document registry as an
    // unsaved-work source, so neither the opener nor the lifecycle imports the feature.
    { provide: IMAGE_FILE_OPENER, useExisting: ImageOpener },
    provideUnsavedWork(ImageDocuments),
  ]);
}
