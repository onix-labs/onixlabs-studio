import { effect, inject, untracked } from '@angular/core';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';

/**
 * The notice a System Monitor conversation carries once (#966). Logs hold file paths, project names
 * and what the app has been doing, and an agent that reads them sends them to its provider.
 */
export const LOG_PRIVACY_NOTICE: string = 'Logs the agent reads are sent to your AI provider';

/**
 * The notice's explanation.
 */
const LOG_PRIVACY_DETAIL: string =
  'They can include file paths, project names and what Studio has been doing. With a local model they stay on this machine.';

/**
 * Adds the privacy notice to each of the view's conversations once, as it starts: when the first message
 * is sent, so a conversation restored from history that already carries it is not told twice. Call in an
 * injection context of the view, whose conversations can begin with its agent panel closed.
 */
export function keepLogPrivacyNotice(): void {
  const agent: Agent = inject(Agent);
  effect((): void => {
    const items: readonly AgentItem[] = agent.items();
    if (needsPrivacyNotice(items)) {
      untracked((): void => agent.note(LOG_PRIVACY_NOTICE, LOG_PRIVACY_DETAIL));
    }
  });
}

/**
 * Determines whether a transcript is due the privacy notice: it has begun, and does not carry it yet.
 * @param items The transcript.
 * @returns Returns true when the notice should be added.
 */
export function needsPrivacyNotice(items: readonly AgentItem[]): boolean {
  return (
    items.some((item: AgentItem): boolean => item.kind === 'user') &&
    !items.some(
      (item: AgentItem): boolean => item.kind === 'notice' && item.text === LOG_PRIVACY_NOTICE,
    )
  );
}
