import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { CODE_KEYBINDINGS } from './code-keybindings';
import { CodeDocumentPanel } from './code-document-panel/code-document-panel';
import { CodeRibbon } from './code-ribbon/code-ribbon';
import { CodeStatusStrip } from './code-status/code-status-strip';
import { CodeView } from './code-view/code-view';

/**
 * Describes the code feature's contribution to the application shell: the leaf view mounted for each
 * code tab, its contextual ribbon, its status strip, and the lean document panel mounted in a
 * workspace document well. The shell renders all four by looking the `code` type up in the feature
 * registry, with no hard-coded knowledge of the feature.
 */
const codeFeature: FeatureDescriptor = {
  type: 'code',
  view: CodeView,
  ribbon: CodeRibbon,
  status: CodeStatusStrip,
  documentPanel: CodeDocumentPanel,
};

/**
 * Registers the code feature with the application shell. The renderer composition root adds this to
 * its provider list — the one place that enumerates features.
 * @returns Returns the environment providers that stand the code feature up at start-up.
 */
export function provideCodeFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(codeFeature),
    provideKeybindingCatalogue(CODE_KEYBINDINGS),
  ]);
}
