import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { MARKDOWN_KEYBINDINGS } from './markdown-keybindings';
import { MarkdownDocumentPanel } from './markdown-document-panel/markdown-document-panel';
import { MarkdownRibbon } from './markdown-ribbon/markdown-ribbon';
import { MarkdownStatusStrip } from './markdown-status/markdown-status-strip';
import { MarkdownView } from './markdown-view/markdown-view';

/**
 * Describes the markdown feature's contribution to the application shell: the leaf view mounted for
 * each markdown tab, its contextual ribbon, its status strip, and the lean document panel mounted in
 * a workspace document well. The shell renders all four by looking the `markdown` type up in the
 * feature registry, with no hard-coded knowledge of the feature.
 */
const markdownFeature: FeatureDescriptor = {
  type: 'markdown',
  view: MarkdownView,
  ribbon: MarkdownRibbon,
  status: MarkdownStatusStrip,
  documentPanel: MarkdownDocumentPanel,
};

/**
 * Registers the markdown feature with the application shell. The renderer composition root adds this
 * to its provider list — the one place that enumerates features.
 * @returns Returns the environment providers that stand the markdown feature up at start-up.
 */
export function provideMarkdownFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(markdownFeature),
    provideKeybindingCatalogue(MARKDOWN_KEYBINDINGS),
  ]);
}
