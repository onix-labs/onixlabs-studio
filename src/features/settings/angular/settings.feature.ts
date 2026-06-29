import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { SettingsView } from './settings-view/settings-view';

/**
 * Describes the settings feature's contribution to the application shell: the settings view mounted
 * for the settings tab, shown full-bleed. Its chrome opts out of both the contextual ribbon and the
 * status strip, so the shell hides them while settings is active — without any hard-coded knowledge
 * of the settings type.
 */
const settingsFeature: FeatureDescriptor = {
  type: 'settings',
  view: SettingsView,
  chrome: { ribbon: false, status: false },
};

/**
 * Registers the settings feature with the application shell. The renderer composition root adds this
 * to its provider list — the one place that enumerates features.
 * @returns Returns the environment providers that stand the settings feature up at start-up.
 */
export function provideSettingsFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([provideFeature(settingsFeature)]);
}
