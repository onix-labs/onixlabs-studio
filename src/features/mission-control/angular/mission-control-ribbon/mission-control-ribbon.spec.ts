import { Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { AiPermissionPosture } from '@shared/api/ai-types';
import type { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentRequestEntry, AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlRibbon } from './mission-control-ribbon';

/**
 * The ribbon internals the tests reach into (protected on the component).
 */
interface RibbonInternals {
  readonly runningCount: Signal<number>;
  readonly pendingPermissions: Signal<number>;
  readonly policyLabel: Signal<string>;
  onStopAll(): void;
  onAllowAll(): void;
  onDenyAll(): void;
  onResetLayout(): void;
  onToggleHideEmpty(): void;
  onToggleHideIdle(): void;
  onPolicy(label: string): void;
}

/**
 * Records how a request entry was answered.
 */
interface Answer {
  readonly item: AgentItem;
  readonly granted: boolean;
}

/**
 * Builds a request entry of the given kind whose agent records how it is answered.
 * @param kind The transcript item's kind.
 * @param answers The recorder the entry's agent appends to.
 * @returns Returns the entry.
 */
function makeEntry(kind: string, answers: Answer[]): AgentRequestEntry {
  const item: unknown = { kind };
  const agent: unknown = {
    respondPermission: (target: AgentItem, granted: boolean): void => {
      answers.push({ item: target, granted });
    },
  };
  return {
    key: `k-${kind}-${answers.length}`,
    tabId: null,
    label: 'Alpha',
    item: item as AgentItem,
    agent: agent as Agent,
  };
}

describe('MissionControlRibbon', () => {
  let ribbon: RibbonInternals;
  let runningCount: WritableSignal<number>;
  let hideEmpty: WritableSignal<boolean>;
  let hideIdle: WritableSignal<boolean>;
  let entries: WritableSignal<readonly AgentRequestEntry[]>;
  let posture: WritableSignal<AiPermissionPosture>;
  let calls: string[];

  beforeEach(() => {
    runningCount = signal<number>(0);
    hideEmpty = signal<boolean>(false);
    hideIdle = signal<boolean>(false);
    entries = signal<readonly AgentRequestEntry[]>([]);
    posture = signal<AiPermissionPosture>('prompt');
    calls = [];

    const missionControlStub: Partial<MissionControl> = {
      hideEmpty: hideEmpty.asReadonly(),
      hideIdle: hideIdle.asReadonly(),
      resetWidths: (): void => void calls.push('resetWidths'),
      setHideEmpty: (value: boolean): void => {
        calls.push(`setHideEmpty:${value}`);
        hideEmpty.set(value);
      },
      setHideIdle: (value: boolean): void => {
        calls.push(`setHideIdle:${value}`);
        hideIdle.set(value);
      },
    };
    const agentHostsStub: Partial<AgentHosts> = {
      runningCount: runningCount.asReadonly(),
      stopAll: (): void => void calls.push('stopAll'),
    };
    const requestsStub: Partial<AgentRequests> = { entries };
    const settingsStub: Partial<Settings> = {
      aiPermissionPosture: posture.asReadonly(),
      setAiPermissionPosture: (value: AiPermissionPosture): void => {
        calls.push(`setPosture:${value}`);
        posture.set(value);
      },
    };

    TestBed.configureTestingModule({
      imports: [MissionControlRibbon],
      providers: [
        { provide: MissionControl, useValue: missionControlStub },
        { provide: AgentHosts, useValue: agentHostsStub },
        { provide: AgentRequests, useValue: requestsStub },
        { provide: Settings, useValue: settingsStub },
      ],
    });
    ribbon = TestBed.createComponent(MissionControlRibbon)
      .componentInstance as unknown as RibbonInternals;
  });

  it('runningCount_reflectsTheLiveHostRegistry', () => {
    expect(ribbon.runningCount()).toBe(0);
    runningCount.set(3);
    expect(ribbon.runningCount()).toBe(3);
  });

  it('pendingPermissions_countsOnlyPermissionRequests', () => {
    const answers: Answer[] = [];
    entries.set([
      makeEntry('permission', answers),
      makeEntry('edit-decision', answers),
      makeEntry('permission', answers),
      makeEntry('input-request', answers),
    ]);

    expect(ribbon.pendingPermissions()).toBe(2);
  });

  it('policyLabel_mapsThePostureToItsLabel', () => {
    expect(ribbon.policyLabel()).toBe('Prompt');

    posture.set('auto-edits');
    expect(ribbon.policyLabel()).toBe('Auto-allow edits');

    posture.set('auto-all');
    expect(ribbon.policyLabel()).toBe('Auto-allow everything');
  });

  it('onStopAll_stopsEveryRunningHost', () => {
    ribbon.onStopAll();
    expect(calls).toEqual(['stopAll']);
  });

  it('onAllowAll_grantsEveryPendingPermission_andLeavesOtherKinds', () => {
    const answers: Answer[] = [];
    const permission: AgentRequestEntry = makeEntry('permission', answers);
    const edit: AgentRequestEntry = makeEntry('edit-decision', answers);
    entries.set([permission, edit]);

    ribbon.onAllowAll();

    expect(answers).toEqual([{ item: permission.item, granted: true }]);
  });

  it('onDenyAll_deniesEveryPendingPermission', () => {
    const answers: Answer[] = [];
    const a: AgentRequestEntry = makeEntry('permission', answers);
    const b: AgentRequestEntry = makeEntry('permission', answers);
    entries.set([a, b]);

    ribbon.onDenyAll();

    expect(answers).toEqual([
      { item: a.item, granted: false },
      { item: b.item, granted: false },
    ]);
  });

  it('onResetLayout_resetsTheTileWidths', () => {
    ribbon.onResetLayout();
    expect(calls).toEqual(['resetWidths']);
  });

  it('onToggleHideEmpty_flipsTheHideEmptyPreference', () => {
    ribbon.onToggleHideEmpty();
    expect(calls).toEqual(['setHideEmpty:true']);

    ribbon.onToggleHideEmpty();
    expect(calls).toEqual(['setHideEmpty:true', 'setHideEmpty:false']);
  });

  it('onToggleHideIdle_flipsTheHideIdlePreference', () => {
    ribbon.onToggleHideIdle();
    expect(calls).toEqual(['setHideIdle:true']);
  });

  it('onPolicy_setsThePostureForAKnownLabel_andIgnoresAnUnknownOne', () => {
    ribbon.onPolicy('Auto-allow everything');
    expect(calls).toEqual(['setPosture:auto-all']);

    ribbon.onPolicy('Not a real policy');
    expect(calls).toEqual(['setPosture:auto-all']);
  });
});
