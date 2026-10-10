import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { MissionControlStatusStrip } from './mission-control-status-strip';

/**
 * Reads the rendered segment texts from the strip's trailing group.
 * @param fixture The mounted status-strip fixture.
 * @returns Returns the segment texts in render order.
 */
function trailingOf(fixture: ComponentFixture<MissionControlStatusStrip>): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(1)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

/**
 * Builds an agent host whose agent reports the given state.
 * @param running Whether the agent is running.
 * @param cost What the agent has cost, in US dollars.
 * @param billedPerToken Whether the agent's connection is billed by the token.
 * @returns Returns the host.
 */
function host(running: boolean, cost: number = 0, billedPerToken: boolean = true): AgentHost {
  const agent: Agent = {
    isRunning: signal<boolean>(running),
    costUsd: signal<number>(cost),
    billedPerToken: signal<boolean>(billedPerToken),
  } as unknown as Agent;
  return { agent } as unknown as AgentHost;
}

describe('MissionControlStatusStrip (#882)', () => {
  let fixture: ComponentFixture<MissionControlStatusStrip>;
  let hosts: WritableSignal<readonly AgentHost[]>;
  let entries: WritableSignal<readonly AgentRequestEntry[]>;

  beforeEach(() => {
    hosts = signal<readonly AgentHost[]>([]);
    entries = signal<readonly AgentRequestEntry[]>([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: AgentHosts, useValue: { hosts } },
        { provide: AgentRequests, useValue: { entries } },
      ],
    });
    fixture = TestBed.createComponent(MissionControlStatusStrip);
  });

  it('countsTheAgents_evenWhenThereAreNone', () => {
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['0 agents']);
  });

  it('countsWorkingAndWaiting_withoutCountingAWaitingAgentTwice', () => {
    const waiting: AgentHost = host(true);
    hosts.set([host(true), waiting, host(false)]);
    entries.set([{ agent: waiting.agent } as unknown as AgentRequestEntry]);
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['3 agents', '1 working', '1 waiting for you']);
  });

  it('totalsTheCost_whenAnyIsReported', () => {
    hosts.set([host(false, 0.25), host(false, 0.17)]);
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['2 agents', '$0.42']);
  });

  it('leavesSubscriptionsOutOfTheTotal', () => {
    // Two agents on a subscription report $0.85 between them, but nothing was charged for it.
    hosts.set([host(false, 0.5, false), host(false, 0.35, false), host(false, 0.1)]);
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['3 agents', '$0.10']);
  });
});
