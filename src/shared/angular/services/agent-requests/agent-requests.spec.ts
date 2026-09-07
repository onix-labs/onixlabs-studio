import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentRequests } from './agent-requests';

describe('AgentRequests', () => {
  let requests: AgentRequests;
  let items: WritableSignal<readonly AgentItem[]>;

  /**
   * Builds a fake agent session over a writable items signal.
   * @returns Returns the fake agent.
   */
  function fakeAgent(): Agent {
    return { items } as unknown as Agent;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    requests = TestBed.inject(AgentRequests);
    items = signal<readonly AgentItem[]>([]);
  });

  it('entries_whenAConversationHasPendingRequests_surfacesThemWithAttribution', () => {
    items.set([
      { id: 'item-1', kind: 'user', text: 'hi' },
      {
        id: 'item-2',
        kind: 'permission',
        text: '',
        permissionId: 'p1',
        permissionName: 'Bash',
        permissionState: 'pending',
      },
      {
        id: 'item-3',
        kind: 'input-request',
        text: '',
        inputId: 'q1',
        inputQuestion: 'Which?',
        inputState: 'pending',
      },
      {
        id: 'item-4',
        kind: 'edit-decision',
        text: '',
        decisionId: 'd1',
        decisionName: 'the active document',
        decisionState: 'pending',
      },
    ]);
    requests.register({
      agent: fakeAgent(),
      tabId: (): string | null => 'tab-1',
      label: (): string => 'main.ts',
    });

    expect(requests.count()).toBe(3);
    expect(requests.entries().map((entry): string => entry.item.id)).toEqual([
      'item-2',
      'item-3',
      'item-4',
    ]);
    expect(requests.entries()[0].label).toBe('main.ts');
    expect(requests.tabIds().has('tab-1')).toBe(true);
  });

  it('entries_whenATranscriptChangesWithoutTouchingRequests_keepsItsValueIdentity', () => {
    // The computed re-runs on every transcript change of every agent — including each streamed-token
    // flush — and almost always produces the same requests it did last time. The equality guard must
    // keep the previous value in that case so downstream effects see nothing.
    const pending: AgentItem = {
      id: 'item-1',
      kind: 'permission',
      text: '',
      permissionId: 'p1',
      permissionName: 'Bash',
      permissionState: 'pending',
    };
    items.set([pending]);
    requests.register({
      agent: fakeAgent(),
      tabId: (): string | null => 'tab-1',
      label: (): string => 'main.ts',
    });
    const before: readonly unknown[] = requests.entries();

    // A streamed token replaces the transcript array (and its streaming tail) but not the request.
    items.set([pending, { id: 'item-2', kind: 'assistant', text: 'streaming…' }]);
    expect(requests.entries()).toBe(before);

    // The empty case — the overwhelmingly common one — must hold its identity too.
    items.set([]);
    const emptyBefore: readonly unknown[] = requests.entries();
    items.set([{ id: 'item-3', kind: 'assistant', text: 'more' }]);
    expect(requests.entries()).toBe(emptyBefore);
  });

  it('entries_whenARequestSettles_dropOffTheList', () => {
    items.set([
      {
        id: 'item-1',
        kind: 'permission',
        text: '',
        permissionId: 'p1',
        permissionName: 'Bash',
        permissionState: 'pending',
      },
    ]);
    requests.register({
      agent: fakeAgent(),
      tabId: (): string | null => null,
      label: (): string => 'Agent panel',
    });
    expect(requests.count()).toBe(1);
    expect(requests.tabIds().size).toBe(0);

    items.set([
      {
        id: 'item-1',
        kind: 'permission',
        text: '',
        permissionId: 'p1',
        permissionName: 'Bash',
        permissionState: 'allowed',
      },
    ]);

    expect(requests.count()).toBe(0);
  });

  it('register_whenUnregistered_removesTheSource', () => {
    items.set([
      {
        id: 'item-1',
        kind: 'permission',
        text: '',
        permissionId: 'p1',
        permissionState: 'pending',
      },
    ]);
    const unregister: () => void = requests.register({
      agent: fakeAgent(),
      tabId: (): string | null => 'tab-1',
      label: (): string => 'main.ts',
    });
    expect(requests.count()).toBe(1);

    unregister();

    expect(requests.count()).toBe(0);
  });
});
