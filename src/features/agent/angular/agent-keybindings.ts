import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the agent tab's keyboard accelerators. Both defaults are non-typing chords, so they do
 * not interfere with the message composer.
 */
export const AGENT_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Agent',
  bindings: [
    { id: 'agent.stop', description: 'Stop the in-flight run', chord: 'Mod+.' },
    { id: 'agent.newChat', description: 'Start a new conversation', chord: 'Mod+Shift+N' },
  ],
};
