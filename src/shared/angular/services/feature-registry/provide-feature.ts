import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { FeatureDescriptor } from './feature-descriptor';
import { FeatureRegistry } from './feature-registry';

/**
 * Builds the providers that register a feature with the application shell at start-up. A feature
 * exposes a `provide<Name>Feature()` function returning this, which the renderer composition root
 * adds to its provider list — the one place that enumerates features.
 * @param descriptor The feature's contribution to the shell.
 * @returns Returns the environment providers that register the feature before the first view renders.
 */
export function provideFeature(descriptor: FeatureDescriptor): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideAppInitializer((): void => {
      inject(FeatureRegistry).register(descriptor);
    }),
  ]);
}
