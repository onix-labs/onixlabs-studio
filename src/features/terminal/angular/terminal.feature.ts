import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { AgentTerminalCapabilities } from './agent-terminal-capabilities/agent-terminal-capabilities';
import { TerminalRibbon } from './terminal-ribbon/terminal-ribbon';
import { TerminalView } from './terminal-view/terminal-view';

/**
 * Describes the terminal feature's contribution to the application shell: the leaf view mounted for
 * each terminal tab and its contextual ribbon. The shell renders both by looking the `terminal` type
 * up in the feature registry, with no hard-coded knowledge of the feature.
 */
const terminalFeature: FeatureDescriptor = {
  type: 'terminal',
  view: TerminalView,
  ribbon: TerminalRibbon,
};

/**
 * Registers the terminal feature with the application shell. The renderer composition root adds this
 * to its provider list — the one place that enumerates features. It registers the feature descriptor
 * and eagerly instantiates the agent's terminal capabilities so they are available to the AI runtime
 * whenever a terminal-surface agent runs.
 * @returns Returns the environment providers that stand the terminal feature up at start-up.
 */
export function provideTerminalFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(terminalFeature),
    provideAppInitializer((): void => {
      inject(AgentTerminalCapabilities);
    }),
  ]);
}
