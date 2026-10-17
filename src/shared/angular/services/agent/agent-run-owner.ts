import { InjectionToken } from '@angular/core';

/**
 * Resolves the owner an agent's runs are stamped with — the id the main process hands back to every
 * in-app capability the run invokes, so the capability acts on THIS agent's workspace rather than the
 * focused one.
 *
 * Provided by a workspace view, whose agent lives at the view rather than in any one panel: the agent
 * panel docked in the workspace, Mission Control's tile and the Configure dialog all drive that same
 * agent, and each would otherwise name a different owner (or none). The view answers with its scope
 * id — the tab id, qualified by the checkout for a worktree sub-view — which is also the key its
 * document well is published under. Hosts that do not provide the token keep the owner their caller
 * passes.
 */
export const AGENT_RUN_OWNER: InjectionToken<() => string> = new InjectionToken<() => string>(
  'AGENT_RUN_OWNER',
);
