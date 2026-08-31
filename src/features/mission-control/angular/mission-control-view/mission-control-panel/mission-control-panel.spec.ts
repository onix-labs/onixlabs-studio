import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  SETTINGS_DEFAULTS,
  SettingsKey,
  SettingsValues,
} from '@shared/angular/services/settings/settings-registry';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MissionControlTiles } from '../mission-control-tiles';
import { MissionControlPanel } from './mission-control-panel';

/**
 * The options backing a fake host, so each test states only the fields it cares about.
 */
interface HostOptions {
  /**
   * Gets the host's display label; defaults to the id.
   */
  readonly label?: string;

  /**
   * Gets whether the host's agent is running.
   */
  readonly running?: boolean;

  /**
   * Gets whether the host's agent has any transcript items.
   */
  readonly hasMessages?: boolean;

  /**
   * Gets the branch the host's project is on; omitted for a host with no project behind it.
   */
  readonly branch?: string;
}

/**
 * Creates a fake live host with a stubbed agent exposing the running and has-messages signals the rail
 * reads. The host has no owning tab, so it needs nothing from the tab registry.
 * @param id The host id.
 * @param options The host's initial state.
 * @returns Returns the fake host.
 */
function makeHost(id: string, options: HostOptions = {}): AgentHost {
  const agent: unknown = {
    isRunning: signal<boolean>(options.running ?? false),
    hasMessages: signal<boolean>(options.hasMessages ?? false),
  };
  const host: unknown = {
    id,
    tabId: null,
    label: signal<string>(options.label ?? id),
    branch: options.branch === undefined ? undefined : signal<string | null>(options.branch),
    surface: 'agent',
    agent,
    conversation: {},
  };
  return host as AgentHost;
}

/**
 * Creates a pending request entry attributed to a host's agent. Only the agent is read by the rail —
 * it marks the row and leaves the asking to the transcript — so the rest of the entry is a stub.
 * @param host The host whose agent is waiting on the user.
 * @returns Returns the request entry.
 */
function entryFor(host: AgentHost): AgentRequestEntry {
  return {
    key: `${host.id}:request`,
    tabId: null,
    label: host.id,
    item: {} as AgentRequestEntry['item'],
    agent: host.agent,
  };
}

describe('MissionControlPanel', () => {
  let fixture: ComponentFixture<MissionControlPanel>;
  let host: HTMLElement;
  let hosts: WritableSignal<readonly AgentHost[]>;
  let entries: WritableSignal<readonly AgentRequestEntry[]>;
  let revealed: string[];

  beforeEach(async () => {
    hosts = signal<readonly AgentHost[]>([]);
    entries = signal<readonly AgentRequestEntry[]>([]);
    revealed = [];

    const agentHostsStub: Partial<AgentHosts> = { hosts };
    const agentRequestsStub: Partial<AgentRequests> = { entries };
    const tabsStub: Partial<Tabs> = { get: () => undefined };
    const tilesStub: Partial<MissionControlTiles> = {
      reveal: (id: string): void => {
        revealed.push(id);
      },
    };
    const settingsStub: Partial<Settings> = {
      // Every control the ribbon draws may ask the settings for its own preferences — an icon-only
      // button asks whether to name itself — so the double answers for any key, with what the
      // registry says that key defaults to.
      value: <K extends SettingsKey>(key: K): Signal<SettingsValues[K]> =>
        signal(SETTINGS_DEFAULTS[key]),
    };

    await TestBed.configureTestingModule({
      imports: [MissionControlPanel],
      providers: [
        { provide: AgentHosts, useValue: agentHostsStub },
        { provide: AgentRequests, useValue: agentRequestsStub },
        { provide: Tabs, useValue: tabsStub },
        { provide: MissionControlTiles, useValue: tilesStub },
        { provide: Settings, useValue: settingsStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MissionControlPanel);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  const rowLabels: () => string[] = (): string[] =>
    Array.from(host.querySelectorAll<HTMLElement>('.list-row .rail__name')).map(
      (el: HTMLElement): string => el.textContent?.trim() ?? '',
    );

  const statusLabels: () => string[] = (): string[] =>
    Array.from(host.querySelectorAll<HTMLElement>('.list-row .rail__status-label')).map(
      (el: HTMLElement): string => el.textContent?.trim() ?? '',
    );

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenNoHosts_showsTheEmptyState', () => {
    expect(host.querySelector('.panel__empty')?.textContent).toContain('No active agents');
    expect(host.querySelector('.list-row')).toBeNull();
  });

  it('render_listsEachHostAsASharedListViewRow', () => {
    hosts.set([makeHost('h1', { label: 'Alpha' }), makeHost('h2', { label: 'Beta' })]);
    fixture.detectChanges();

    expect(rowLabels()).toEqual(['Alpha', 'Beta']);
  });

  it('statusLabel_isWorkingWhileRunning_thenIdleWithMessages_thenReadyWhenEmpty', () => {
    hosts.set([
      makeHost('running', { label: 'Running', running: true, hasMessages: true }),
      makeHost('idle', { label: 'Idle', running: false, hasMessages: true }),
      makeHost('ready', { label: 'Ready', running: false, hasMessages: false }),
    ]);
    fixture.detectChanges();

    expect(statusLabels()).toEqual(['Working', 'Idle', 'Ready']);
  });

  it('statusLabel_whenAgentGoesIdleWithMessages_switchesFromReadyToIdle', () => {
    const idleHost: AgentHost = makeHost('h1', { label: 'Alpha', hasMessages: false });
    hosts.set([idleHost]);
    fixture.detectChanges();
    expect(statusLabels()).toEqual(['Ready']);

    (idleHost.agent.hasMessages as WritableSignal<boolean>).set(true);
    fixture.detectChanges();

    expect(statusLabels()).toEqual(['Idle']);
  });

  it('render_namesTheBranchOfAProjectBackedHost_andPlaceholdsForTheRest', () => {
    hosts.set([
      makeHost('h1', { label: 'Alpha', branch: 'feature/x' }),
      makeHost('h2', { label: 'Beta' }),
    ]);
    fixture.detectChanges();

    const rows: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.list-row'));
    expect(rows[0].querySelector('.rail__branch')?.textContent?.trim()).toBe('feature/x');
    // An agent with no repository behind it keeps the line, so every row reads the same way.
    const placeholder: HTMLElement | null = rows[1].querySelector<HTMLElement>('.rail__branch');
    expect(placeholder?.textContent?.trim()).toBe('No repository');
    expect(placeholder?.classList.contains('rail__branch--none')).toBe(true);
  });

  it('onRowClick_whenARowIsClicked_revealsThatHostsColumn', () => {
    hosts.set([makeHost('h1', { label: 'Alpha' }), makeHost('h2', { label: 'Beta' })]);
    fixture.detectChanges();

    host.querySelectorAll<HTMLElement>('.list-row')[1].click();

    expect(revealed).toEqual(['h2']);
  });

  it('render_showsNoTabSwitchOrSettingsButton', () => {
    hosts.set([makeHost('h1', { label: 'Alpha' })]);
    fixture.detectChanges();

    // The panel is the agent rail and nothing else: no Agents/Settings tab switch, and no gear in the
    // header deep-linking to the settings category.
    expect(host.querySelector('.panel__tabs')).toBeNull();
    expect(host.querySelector('.panel__header app-button')).toBeNull();
  });

  it('render_answersNoRequestInline_soTheRailOnlyPointsAtTheColumn', () => {
    const waiting: AgentHost = makeHost('h1', { label: 'Alpha' });
    hosts.set([waiting]);
    entries.set([entryFor(waiting)]);
    fixture.detectChanges();

    // Requests were once mirrored here as inline answer cards, under an "Other requests" group for
    // agents with no column. Both are gone even while one is pending: the rail marks the row, and the
    // request is answered on the agent's own transcript.
    expect(host.querySelector('app-agent-request-card')).toBeNull();
    expect(host.querySelector('.rail__requests')).toBeNull();
    expect(host.querySelector('.panel__group')).toBeNull();
  });

  it('render_marksOnlyTheRowsWhoseAgentIsWaitingOnTheUser', () => {
    const waiting: AgentHost = makeHost('h1', { label: 'Alpha' });
    const busy: AgentHost = makeHost('h2', { label: 'Beta', running: true });
    hosts.set([waiting, busy]);
    entries.set([entryFor(waiting)]);
    fixture.detectChanges();

    const rows: HTMLElement[] = Array.from(host.querySelectorAll<HTMLElement>('.list-row'));
    // Matched on the agent, not the host: the marker has to follow the conversation a request belongs
    // to, and a running agent is not the same thing as one that has stopped to ask.
    expect(rows[0].querySelector('.rail__item--waiting')).not.toBeNull();
    expect(rows[1].querySelector('.rail__item--waiting')).toBeNull();
  });

  it('statusLabel_whenTheAgentIsWaitingOnTheUser_readsWaitingRatherThanWorking', () => {
    const waiting: AgentHost = makeHost('h1', { label: 'Alpha', running: true, hasMessages: true });
    hosts.set([waiting]);
    entries.set([entryFor(waiting)]);
    fixture.detectChanges();

    // The agent is still running as far as the session is concerned — it has merely stopped to ask —
    // so Waiting has to outrank Working, or the row names the one state the user cannot act on.
    expect(statusLabels()).toEqual(['Waiting']);
  });

  it('render_whenTheRequestSettles_dropsTheWaitingMark', () => {
    const waiting: AgentHost = makeHost('h1', { label: 'Alpha' });
    hosts.set([waiting]);
    entries.set([entryFor(waiting)]);
    fixture.detectChanges();
    expect(host.querySelector('.rail__item--waiting')).not.toBeNull();

    entries.set([]);
    fixture.detectChanges();

    expect(host.querySelector('.rail__item--waiting')).toBeNull();
    expect(statusLabels()).toEqual(['Ready']);
  });

  it('render_marksTheWholeListRow_soTheTrailingButtonsAreInsideIt', () => {
    const waiting: AgentHost = makeHost('h1', { label: 'Alpha' });
    hosts.set([waiting]);
    entries.set([entryFor(waiting)]);
    fixture.detectChanges();

    // The mark is painted on `.list-row` (selected via `:has`), not on the projected item, so the hide
    // toggle and the reorder grip fall inside it. Asserting containment rather than colour: the styles
    // are global and unresolvable here, and CI declines to compute them at all.
    const row: HTMLElement | null = host.querySelector<HTMLElement>('.list-row');
    expect(row?.querySelector('.rail__item--waiting')).not.toBeNull();
    expect(row?.querySelector('.rail__hide')).not.toBeNull();
    expect(row?.querySelector('.list-row__grip')).not.toBeNull();
  });
});
