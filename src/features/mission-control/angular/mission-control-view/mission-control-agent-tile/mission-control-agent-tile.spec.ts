import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Agent } from '@shared/angular/services/agent/agent';
import {
  AGENT_HOST,
  AgentHost,
  HostRunLauncher,
} from '@shared/angular/services/agent-hosts/agent-hosts';
import { RunConfiguration } from '@shared/api/studio';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlTiles } from '../mission-control-tiles';
import { MissionControlAgentTile } from './mission-control-agent-tile';

/**
 * The tile's derived state read by the tests. The gating condition for mounting the (expensive) mirror
 * body is `active() && !hidden()`, so `hidden` — and the `isEmpty`/`isIdle` it is built from — is the
 * logic under test here.
 */
interface TileState {
  readonly isEmpty: Signal<boolean>;
  readonly isIdle: Signal<boolean>;
  readonly hidden: Signal<boolean>;
  readonly statusLabel: Signal<string>;
  readonly hasTab: Signal<boolean>;
  readonly tabId: Signal<string | undefined>;
  readonly key: Signal<string>;
  readonly branch: Signal<string | null>;
  readonly branchLabel: Signal<string>;
  readonly defaultRun: Signal<RunConfiguration | null>;
  readonly runStarting: Signal<boolean>;
  readonly runRunning: Signal<boolean>;
  onRun(): void;
  onStop(): void;
}

/**
 * Builds a host Run launcher whose signals and callbacks the tests drive, defaulting the parts a test
 * does not care about so a test states only what it exercises.
 * @param overrides The launcher parts to override.
 * @returns Returns the launcher.
 */
function runLauncher(overrides: Partial<HostRunLauncher> = {}): HostRunLauncher {
  return {
    defaultConfiguration: signal<RunConfiguration | null>(null),
    starting: signal<boolean>(false),
    running: signal<boolean>(false),
    run: (): void => undefined,
    stop: (): void => undefined,
    ...overrides,
  };
}

/**
 * The knobs the individual tests set on the fixture.
 */
interface Knobs {
  readonly running: WritableSignal<boolean>;
  readonly items: WritableSignal<readonly unknown[]>;
  readonly hideEmpty: WritableSignal<boolean>;
  readonly hideIdle: WritableSignal<boolean>;
  readonly hideWorking: WritableSignal<boolean>;
  readonly hiddenHosts: WritableSignal<ReadonlySet<string>>;
}

/**
 * Builds a tile whose injected host, agent and Mission Control state the returned knobs drive, and
 * returns its derived-state signals. The component is created but not change-detected, so the mirror
 * body (and its heavy child tree) is never mounted — only the tile's own computeds are exercised.
 * @param options The host's tab id (null for a host with no owning tab), and its branch signal (absent
 * for a host with no project behind it).
 * @returns Returns the tile's derived state and the knobs backing it.
 */
function setUp(
  options: {
    tabId?: string | null;
    branch?: Signal<string | null>;
    run?: HostRunLauncher;
  } = {},
): {
  state: TileState;
  knobs: Knobs;
  fixture: ComponentFixture<MissionControlAgentTile>;
} {
  const running: WritableSignal<boolean> = signal<boolean>(false);
  const items: WritableSignal<readonly unknown[]> = signal<readonly unknown[]>([]);
  const hideEmpty: WritableSignal<boolean> = signal<boolean>(false);
  const hideIdle: WritableSignal<boolean> = signal<boolean>(false);
  const hideWorking: WritableSignal<boolean> = signal<boolean>(false);
  const hiddenHosts: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  const agentStub: unknown = { isRunning: running, items };
  const hostStub: unknown = {
    id: 'host-1',
    tabId: options.tabId ?? null,
    label: signal<string>('Alpha'),
    branch: options.branch,
    run: options.run,
    surface: 'agent',
    agent: agentStub,
    conversation: {},
  };
  const conversationStub: Partial<AgentConversation> = { currentId: signal<string | null>(null) };
  const missionControlStub: Partial<MissionControl> = {
    hideEmpty: hideEmpty.asReadonly(),
    hideIdle: hideIdle.asReadonly(),
    hideWorking: hideWorking.asReadonly(),
    hiddenHosts: hiddenHosts.asReadonly(),
    widthFor: (): number => 320,
    setWidth: (): void => undefined,
  };
  const tabsStub: Partial<Tabs> = { get: () => undefined, activate: () => undefined };
  const tilesStub: Partial<MissionControlTiles> = {
    register: (): (() => void) => (): void => undefined,
  };

  TestBed.configureTestingModule({
    imports: [MissionControlAgentTile],
    providers: [
      { provide: AGENT_HOST, useValue: hostStub as AgentHost },
      { provide: Agent, useValue: agentStub },
      { provide: AgentConversation, useValue: conversationStub },
      { provide: MissionControl, useValue: missionControlStub },
      { provide: Tabs, useValue: tabsStub },
      { provide: MissionControlTiles, useValue: tilesStub },
    ],
  });

  const fixture: ComponentFixture<MissionControlAgentTile> =
    TestBed.createComponent(MissionControlAgentTile);
  const state: TileState = fixture.componentInstance as unknown as TileState;
  return {
    state,
    knobs: { running, items, hideEmpty, hideIdle, hideWorking, hiddenHosts },
    fixture,
  };
}

describe('MissionControlAgentTile', () => {
  it('state_whenNoMessagesAndNotRunning_isEmptyAndReadsReady', () => {
    const { state } = setUp();

    expect(state.isEmpty()).toBe(true);
    expect(state.isIdle()).toBe(false);
    expect(state.statusLabel()).toBe('Ready');
  });

  it('state_whenMessagesButNotRunning_isIdle', () => {
    const { state, knobs } = setUp();
    knobs.items.set([{}]);

    expect(state.isEmpty()).toBe(false);
    expect(state.isIdle()).toBe(true);
    expect(state.statusLabel()).toBe('Idle');
  });

  it('state_whenRunning_isNeitherEmptyNorIdleAndReadsWorking', () => {
    const { state, knobs } = setUp();
    knobs.running.set(true);

    expect(state.isEmpty()).toBe(false);
    expect(state.isIdle()).toBe(false);
    expect(state.statusLabel()).toBe('Working');
  });

  it('hidden_whenEmpty_followsTheHideEmptyPreference', () => {
    const { state, knobs } = setUp();
    // Empty (no messages, not running).
    expect(state.hidden()).toBe(false);

    knobs.hideEmpty.set(true);
    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenIdle_followsTheHideIdlePreference', () => {
    const { state, knobs } = setUp();
    knobs.items.set([{}]); // idle: has messages, not running

    expect(state.hidden()).toBe(false);
    knobs.hideIdle.set(true);
    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenRunning_isUntouchedByTheOtherTwoStatePreferences', () => {
    // The three run-state toggles partition the tiles, so each catches only its own state: a working
    // column is not decluttered by Hide Empty or Hide Idle, which describe columns it is not one of.
    const { state, knobs } = setUp();
    knobs.running.set(true);
    knobs.items.set([{}]);
    knobs.hideEmpty.set(true);
    knobs.hideIdle.set(true);

    expect(state.hidden()).toBe(false);
  });

  it('hidden_whenRunning_followsTheHideWorkingPreference', () => {
    // Hide Working is the third of the run-state filters and carries no focus exemption: a working
    // column keeps running out of sight, and comes back when the toggle goes off.
    const { state, knobs } = setUp();
    knobs.running.set(true);

    expect(state.hidden()).toBe(false);
    knobs.hideWorking.set(true);
    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenIdleOrEmpty_isUntouchedByHideWorking', () => {
    // The other side of the partition: Hide Working catches only a run in flight, so a settled or
    // never-used column stays put under it.
    const { state, knobs } = setUp();
    knobs.hideWorking.set(true);
    expect(state.hidden()).toBe(false);

    knobs.items.set([{}]); // idle: has messages, not running
    expect(state.hidden()).toBe(false);
  });

  it('hidden_whenManuallyHidden_isHiddenEvenWhileRunning', () => {
    // The per-agent hide toggle is OR-ed with (and carries no exemption from) the blanket toggles: a
    // manually hidden agent is hidden even while running, with every blanket toggle off.
    const { state, knobs } = setUp();
    knobs.running.set(true);
    expect(state.hidden()).toBe(false);

    knobs.hiddenHosts.set(new Set<string>(['host-1']));
    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenTabBackedAndEmptyWithoutFocus_isHiddenByHideEmpty', () => {
    // Hide Empty declutters agent tabs too: an empty column the user is not working in is decluttered
    // like any other. (The focus exemption below is what preserves the New-chat protection.)
    const { state, knobs } = setUp({ tabId: 'tab-9' });
    knobs.hideEmpty.set(true);

    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenEmptyAndFocused_isExemptFromHideEmpty', () => {
    // The column the user is actively in stays put: New chat empties the transcript while focus is
    // still inside the tile (on the tool-strip button / composer), so Hide Empty must not make it
    // vanish out from under the button just clicked. The exemption lifts once focus leaves.
    const { state, knobs, fixture } = setUp({ tabId: 'tab-9' });
    knobs.hideEmpty.set(true);
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    // Empty + Hide Empty, but focus is inside the tile — stays visible.
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(state.hidden()).toBe(false);

    // Focus leaves the tile entirely — it is decluttered like any other empty column.
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenTabBackedAndIdle_followsTheHideIdlePreference', () => {
    // Hide Idle is a general declutter and applies to agent tabs too — an idle column (a settled
    // conversation) has no New-chat vanish hazard and is reachable via its tab and by toggling off.
    // This is the behaviour that regressed when the whole hide condition was gated on `tabId===null`.
    const { state, knobs } = setUp({ tabId: 'tab-9' });
    knobs.items.set([{}]); // idle: has messages, not running

    expect(state.hidden()).toBe(false);
    knobs.hideIdle.set(true);
    expect(state.hidden()).toBe(true);
  });

  it('hidden_whenTabLessAndEmpty_isHiddenByHideEmpty', () => {
    // The other side of the split: a transient tab-less panel (workspace/repository) IS decluttered
    // by Hide Empty, so the toggle is not a no-op.
    const { state, knobs } = setUp({ tabId: null });
    knobs.hideEmpty.set(true);

    expect(state.hidden()).toBe(true);
  });

  it('tab_whenHostHasNoOwningTab_hasNoTabAndKeysOnTheHostId', () => {
    const { state } = setUp({ tabId: null });

    expect(state.hasTab()).toBe(false);
    expect(state.tabId()).toBeUndefined();
    expect(state.key()).toBe('host-1');
  });

  it('tab_whenHostHasAnOwningTab_hasATabAndKeysOnTheTabId', () => {
    const { state } = setUp({ tabId: 'tab-9' });

    expect(state.hasTab()).toBe(true);
    expect(state.tabId()).toBe('tab-9');
    expect(state.key()).toBe('tab-9');
  });

  it('branch_whenHostHasNoProject_readsNullAndLabelsThePlaceholder', () => {
    const { state } = setUp();

    expect(state.branch()).toBeNull();
    expect(state.branchLabel()).toBe('No repository');
  });

  it('branch_whenHostIsProjectBacked_followsTheHostsBranchLive', () => {
    const branch: WritableSignal<string | null> = signal<string | null>('main');
    const { state } = setUp({ tabId: 'tab-9', branch: branch.asReadonly() });

    expect(state.branch()).toBe('main');

    // A checkout in the origin tab renames the branch beside the column's title...
    branch.set('feature/x');
    expect(state.branch()).toBe('feature/x');

    // ...and a detached head (or a folder that is not a repository) falls back to the placeholder.
    branch.set(null);
    expect(state.branch()).toBeNull();
    expect(state.branchLabel()).toBe('No repository');
  });

  it('run_whenHostHasNoRunCapability_hasNoDefault', () => {
    // A host with no workspace behind it carries no Run capability, so the header's Run button (gated
    // on defaultRun()) never shows.
    const { state } = setUp({ tabId: 'tab-9' });

    expect(state.defaultRun()).toBeNull();
  });

  it('run_followsTheHostsDefaultConfigurationLive', () => {
    const configuration: RunConfiguration = {
      id: 'web',
      name: 'Web',
      providerKind: 'node',
      mode: 'run',
      default: true,
    };
    const defaultConfiguration: WritableSignal<RunConfiguration | null> =
      signal<RunConfiguration | null>(configuration);
    const { state } = setUp({
      tabId: 'tab-9',
      run: runLauncher({ defaultConfiguration: defaultConfiguration.asReadonly() }),
    });

    expect(state.defaultRun()?.id).toBe('web');

    // Clearing the workspace's default (in Configure) retracts the button without a re-mount.
    defaultConfiguration.set(null);
    expect(state.defaultRun()).toBeNull();
  });

  it('run_reflectsTheStartingThenRunningStatesLive', () => {
    const starting: WritableSignal<boolean> = signal<boolean>(false);
    const running: WritableSignal<boolean> = signal<boolean>(false);
    const { state } = setUp({
      tabId: 'tab-9',
      run: runLauncher({ starting: starting.asReadonly(), running: running.asReadonly() }),
    });

    expect(state.runStarting()).toBe(false);
    expect(state.runRunning()).toBe(false);

    // Pressed: launching (spinner) — then the process starts (Stop).
    starting.set(true);
    expect(state.runStarting()).toBe(true);
    starting.set(false);
    running.set(true);
    expect(state.runStarting()).toBe(false);
    expect(state.runRunning()).toBe(true);
  });

  it('onRun_andOnStop_invokeTheHostsRunLauncher', () => {
    let ran: number = 0;
    let stopped: number = 0;
    const { state } = setUp({
      tabId: 'tab-9',
      run: runLauncher({
        run: (): void => {
          ran += 1;
        },
        stop: (): void => {
          stopped += 1;
        },
      }),
    });

    state.onRun();
    state.onStop();
    expect(ran).toBe(1);
    expect(stopped).toBe(1);
  });
});
