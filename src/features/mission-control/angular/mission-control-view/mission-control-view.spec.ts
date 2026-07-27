import { Injector, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AgentSurface } from '@shared/api/ai-types';
import { Agent } from '@shared/angular/services/agent/agent';
import {
  AGENT_HOST,
  AgentHost,
  AgentHosts,
} from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { Settings } from '@shared/angular/services/settings/settings';
import { TileScrollMode } from '@shared/angular/services/settings/settings-registry';
import { MissionControlView } from './mission-control-view';

/**
 * The view internals the tests reach into. `injectorFor` and `tileInputs` are protected on the
 * component; the tests read them through this shape rather than rendering the heavy tile tree.
 */
interface ViewInternals {
  injectorFor(host: AgentHost): Injector;
  readonly tileInputs: Signal<Record<string, unknown>>;
}

/**
 * Creates a fake live host carrying distinct agent and conversation identities, so the per-host
 * injector's resolution can be asserted.
 * @param id The host id.
 * @returns Returns the fake host.
 */
function makeHost(id: string): AgentHost {
  const host: unknown = {
    id,
    tabId: null,
    label: signal<string>(id),
    surface: 'agent' as AgentSurface,
    agent: { name: `${id}-agent` },
    conversation: { name: `${id}-conversation` },
    isActive: signal<boolean>(false),
  };
  return host as AgentHost;
}

describe('MissionControlView', () => {
  let fixture: ComponentFixture<MissionControlView>;
  let view: ViewInternals;

  beforeEach(() => {
    const hosts: WritableSignal<readonly AgentHost[]> = signal<readonly AgentHost[]>([]);
    const scrollMode: WritableSignal<TileScrollMode> = signal<TileScrollMode>('into-view');
    TestBed.configureTestingModule({
      imports: [MissionControlView],
      providers: [
        { provide: AgentHosts, useValue: { hosts } },
        { provide: Settings, useValue: { missionControlTileScrollMode: scrollMode } },
      ],
    });
    // Created but never change-detected: the constructor's logic runs without mounting the tile tree
    // (which would pull in the mirror AgentChat and the rail's dependencies).
    fixture = TestBed.createComponent(MissionControlView);
    fixture.componentRef.setInput('tabId', 'mc-tab');
    view = fixture.componentInstance as unknown as ViewInternals;
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('injectorFor_isCachedPerHost_soTilesAreNotRebuiltEachChangeDetection', () => {
    const host: AgentHost = makeHost('h1');

    const first: Injector = view.injectorFor(host);
    const second: Injector = view.injectorFor(host);

    expect(second).toBe(first);
  });

  it('injectorFor_givesADistinctInjectorPerHost', () => {
    const injectorA: Injector = view.injectorFor(makeHost('h1'));
    const injectorB: Injector = view.injectorFor(makeHost('h2'));

    expect(injectorA).not.toBe(injectorB);
  });

  it('injectorFor_providesTheHostsOwnAgent_conversation_andHandle', () => {
    const host: AgentHost = makeHost('h1');

    const injector: Injector = view.injectorFor(host);

    // The tile drives the very same instances as the origin, not copies.
    expect(injector.get(Agent)).toBe(host.agent);
    expect(injector.get(AgentConversation)).toBe(host.conversation);
    expect(injector.get(AGENT_HOST)).toBe(host);
  });

  it('tileInputs_forwardWhetherMissionControlIsTheActiveTab', () => {
    // Default: not the active tab.
    expect(view.tileInputs()).toEqual({ active: false });

    fixture.componentRef.setInput('isActive', true);
    expect(view.tileInputs()).toEqual({ active: true });
  });
});
