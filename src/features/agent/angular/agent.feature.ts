import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { FeatureDescriptor, provideFeature } from '@shared/angular/services/feature-registry';
import { provideKeybindingCatalogue } from '@shared/angular/services/keybindings/keybinding-catalogue';
import { AGENT_KEYBINDINGS } from './agent-keybindings';
import { AgentEditorCapabilities } from './agent-editor-capabilities/agent-editor-capabilities';
import { AgentRibbon } from './agent-ribbon/agent-ribbon';
import { AgentStatusStrip } from './agent-status/agent-status-strip';
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
  status: AgentStatusStrip,
};

/**
 * Registers the agent feature with the application shell. The renderer composition root adds this to
 * its provider list — the one place that enumerates features. The agent feature owns no electron or
 * api surface: its view composes the shared `<app-agent>` over the shared agent runtime. It also
 * eagerly instantiates the agent's in-app editor capabilities so they are registered with the AI
 * runtime whenever an agent runs (reading/replacing the active code or markdown editor).
 * @returns Returns the environment providers that stand the agent feature up at start-up.
 */
export function provideAgentFeature(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFeature(agentFeature),
    provideKeybindingCatalogue(AGENT_KEYBINDINGS),
    provideAppInitializer((): void => {
      inject(AgentEditorCapabilities);
    }),
  ]);
}
