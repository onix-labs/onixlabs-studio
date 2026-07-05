import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
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
 * its provider list — the one place that enumerates features.
 * @returns Returns the environment providers that stand the binary feature up at start-up.
 */
export function provideBinaryFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([provideFeature(binaryFeature)]);
}
