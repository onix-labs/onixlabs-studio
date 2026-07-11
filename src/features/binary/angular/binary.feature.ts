import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { BINARY_FILE_OPENER } from '@shared/angular/services/file-opener/binary-file-opener';
import { provideUnsavedWork } from '@shared/angular/services/unsaved-work/unsaved-work';
import { BinaryDocuments } from './binary-document/binary-document';
import { BinaryAgentCapabilities } from './binary-agent-capabilities/binary-agent-capabilities';
import { BinaryRibbon } from './binary-ribbon/binary-ribbon';
import { BinaryView } from './binary-view/binary-view';

/**
 * Describes the binary feature's contribution to the application shell: the tab view mounted for each
 * binary tab and its contextual ribbon. The shell renders both by looking the `binary` type up in the
 * feature registry, with no hard-coded knowledge of the feature. Binary tabs are top-level (like the
 * terminal), so no document-well panel is contributed.
 */
const binaryFeature: FeatureDescriptor = {
  type: 'binary',
  view: BinaryView,
  ribbon: BinaryRibbon,
};

/**
 * Registers the binary feature with the application shell. The renderer composition root adds this to
 * its provider list — the one place that enumerates features. It also eagerly instantiates the binary
 * agent capabilities so they are registered with the AI runtime whenever a binary agent runs (reading
 * the open binary's hex/ASCII/disassembly and patching its bytes).
 * @returns Returns the environment providers that stand the binary feature up at start-up.
 */
export function provideBinaryFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(binaryFeature),
    // Contribute the binary document registry as the opener for files no text editor can open, and
    // as an unsaved-work source, so the shared FileOpener and Lifecycle never import the feature.
    { provide: BINARY_FILE_OPENER, useExisting: BinaryDocuments },
    provideUnsavedWork(BinaryDocuments),
    provideAppInitializer((): void => {
      inject(BinaryAgentCapabilities);
    }),
  ]);
}
