import { vi } from 'vitest';
import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { AgentItem } from '@shared/angular/services/agent/agent';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AgentRequestToasts } from './agent-request-toasts';
import { DesktopNotifications } from './desktop-notifications';
import { Notification, Notifications } from './notifications';

/**
 * Builds a pending permission ask attributed to a tab (or none).
 * @param key The entry key.
 * @param tabId The hosting tab, or null for an unattributed panel agent.
 * @param label The hosting surface's label.
 * @returns Returns the entry.
 */
function ask(key: string, tabId: string | null, label: string): AgentRequestEntry {
  return {
    key,
    tabId,
    label,
    item: { kind: 'permission', permissionName: 'Bash' } as AgentItem,
    agent: undefined as unknown as AgentRequestEntry['agent'],
  };
}

describe('AgentRequestToasts', () => {
  let entries: WritableSignal<readonly AgentRequestEntry[]>;
  let notifications: Notifications;
  let settings: Settings;
  let tabs: Tabs;

  /**
   * Flushes the bridge's effect.
   */
  function tick(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  beforeEach(() => {
    entries = signal<readonly AgentRequestEntry[]>([]);
    TestBed.configureTestingModule({
      providers: [{ provide: AgentRequests, useValue: { entries } }],
    });
    notifications = TestBed.inject(Notifications);
    settings = TestBed.inject(Settings);
    tabs = TestBed.inject(Tabs);
    TestBed.inject(AgentRequestToasts);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('ask_whenTheSettingIsOff_raisesNothing', () => {
    entries.set([ask('a1', 'tab-1', 'Workspace')]);
    tick();

    expect(notifications.toasts().length).toBe(0);
  });

  it('ask_whenEnabledForABackgroundTab_raisesAStickyToastOnly', () => {
    settings.set('notifications.agentRequestToasts', true);
    entries.set([ask('a1', 'background-tab', 'Workspace')]);
    tick();

    const toast: Notification = notifications.toasts()[0];
    expect(toast.title).toBe('Agent asks — Workspace');
    expect(toast.detail).toBe('Allow Bash?');
    expect(toast.sticky).toBe(true);
    expect(notifications.history().length).toBe(0);
  });

  it('ask_whenItSettles_retractsItsToast', () => {
    settings.set('notifications.agentRequestToasts', true);
    entries.set([ask('a1', 'background-tab', 'Workspace')]);
    tick();
    expect(notifications.toasts().length).toBe(1);

    entries.set([]);
    tick();

    expect(notifications.toasts().length).toBe(0);
  });

  it('ask_inTheActiveTab_staysSilentUntilTheUserSwitchesAway', () => {
    settings.set('notifications.agentRequestToasts', true);
    const owning: Tab = tabs.open('terminal');
    entries.set([ask('a1', owning.id, 'Terminal')]);
    tick();
    expect(notifications.toasts().length).toBe(0);

    tabs.open('settings');
    tick();

    expect(notifications.toasts().length).toBe(1);
  });

  it('askToast_showAction_activatesTheAskingTabAndRetracts', () => {
    settings.set('notifications.agentRequestToasts', true);
    const owning: Tab = tabs.open('terminal');
    tabs.open('settings');
    entries.set([ask('a1', owning.id, 'Terminal')]);
    tick();

    notifications.toasts()[0].actions[0].run();
    tick();

    expect(tabs.activeTab()?.id).toBe(owning.id);
    expect(notifications.toasts().length).toBe(0);
  });
});

describe('AgentRequestToasts on the desktop', () => {
  let entries: WritableSignal<readonly AgentRequestEntry[]>;
  let focused: WritableSignal<boolean>;
  let shown: { title: string; body?: string; reveal?: () => void }[];

  beforeEach(() => {
    entries = signal<readonly AgentRequestEntry[]>([]);
    focused = signal<boolean>(true);
    shown = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: AgentRequests, useValue: { entries } },
        {
          provide: DesktopNotifications,
          useValue: {
            focused,
            show: (title: string, body?: string, reveal?: () => void): void =>
              void shown.push({ title, body, reveal }),
          },
        },
      ],
    });
    TestBed.inject(AgentRequestToasts);
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Flushes the bridge's effects.
   */
  function tick(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  it('announcesAWaitingAgentOnceWhileStudioIsInTheBackground_whateverTheToastSetting', () => {
    // #927: the toast setting is off by default; the desktop announcement does not depend on it.
    entries.set([ask('a1', 'tab-1', 'Workspace')]);
    tick();
    expect(shown).toEqual([]);

    focused.set(false);
    tick();
    expect(shown.map((entry) => entry.title)).toEqual(['Agent asks — Workspace']);
    expect(shown[0].body).toBe('Allow Bash?');

    focused.set(true);
    tick();
    focused.set(false);
    tick();
    expect(shown.length).toBe(1);

    const activate: ReturnType<typeof vi.spyOn> = vi.spyOn(TestBed.inject(Tabs), 'activate');
    shown[0].reveal?.();
    expect(activate).toHaveBeenCalledWith('tab-1');
  });
});
