import { describe, expect, it } from 'vitest';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { LOG_PRIVACY_NOTICE, needsPrivacyNotice } from './system-monitor-agent-panel';

/**
 * Builds a transcript item.
 * @param kind Its kind.
 * @param text Its text.
 * @returns Returns the item.
 */
function item(kind: AgentItem['kind'], text: string): AgentItem {
  return { id: `${kind}-${text}`, kind, text };
}

describe('needsPrivacyNotice', () => {
  it('isDueOnceAConversationHasBegun_andOnlyOnce', () => {
    // #966: once per conversation, as it starts.
    expect(needsPrivacyNotice([])).toBe(false);
    expect(needsPrivacyNotice([item('user', 'why did it fail?')])).toBe(true);
    expect(
      needsPrivacyNotice([item('user', 'why did it fail?'), item('notice', LOG_PRIVACY_NOTICE)]),
    ).toBe(false);
  });
});
