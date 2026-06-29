import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { AgentRibbon } from './agent-ribbon/agent-ribbon';
import { AgentView } from './agent-view/agent-view';

/**
 * Describes the agent feature's contribution to the application shell: the standalone agent-chat view
 * mounted for each agent tab and its contextual ribbon. The shell renders both by looking the `agent`
 * type up in the feature registry, with no hard-coded knowledge of the feature.
 */
const agentFeature: FeatureDescriptor = {
  type: 'agent',
  view: AgentView,
  ribbon: AgentRibbon,
};

/**
 * Registers the agent feature with the application shell. The renderer composition root adds this to
 * its provider list — the one place that enumerates features. The agent feature owns no electron or
 * api surface: its view composes the shared `<app-agent>` over the shared agent runtime.
 * @returns Returns the environment providers that stand the agent feature up at start-up.
 */
export function provideAgentFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([provideFeature(agentFeature)]);
}
