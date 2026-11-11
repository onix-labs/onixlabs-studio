import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentPhase } from '@shared/angular/services/agent/agent-controls';
import { AiModelInfo } from '@shared/api/ai/ai-provider-types';
import { AgentStatusStrip } from './agent-status-strip';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<AgentStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('AgentStatusStrip (#882)', () => {
  let fixture: ComponentFixture<AgentStatusStrip>;
  let providerLabel: WritableSignal<string | null>;
  let phase: WritableSignal<AgentPhase>;
  let mode: WritableSignal<'agent' | 'chat'>;
  let contextTokens: WritableSignal<number>;
  let costUsd: WritableSignal<number>;
  let tasks: WritableSignal<number>;
  let billedPerToken: WritableSignal<boolean>;
  let unsandboxed: WritableSignal<number>;
  let revealNextUnsandboxed: ReturnType<typeof vi.fn>;
  let agentStub: Record<string, unknown>;

  beforeEach(() => {
    revealNextUnsandboxed = vi.fn();
    providerLabel = signal<string | null>('Claude');
    phase = signal<AgentPhase>('idle');
    mode = signal<'agent' | 'chat'>('agent');
    contextTokens = signal<number>(26_204);
    costUsd = signal<number>(0.07);
    tasks = signal<number>(0);
    billedPerToken = signal<boolean>(true);
    unsandboxed = signal<number>(0);
    const models: readonly AiModelInfo[] = [
      { id: 'opus', label: 'Opus 5.5', contextWindow: 1_000_000 },
    ];
    agentStub = {
      providerLabel,
      model: signal<string>('opus'),
      models: signal<readonly AiModelInfo[]>(models),
      phase,
      mode,
      contextTokens,
      contextWindow: signal<number>(1_000_000),
      costUsd,
      billedPerToken,
      visibleTaskCount: tasks,
      unsandboxedRuns: unsandboxed,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Agent, useValue: agentStub },
        { provide: AgentConversation, useValue: { revealNextUnsandboxed } },
      ],
    });
    fixture = TestBed.createComponent(AgentStatusStrip);
  });

  it('namesTheConnectionThenTheModel', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['Claude', 'Opus 5.5']);
  });

  it('reportsTheModeContextAndCost_whileIdle', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['Agent mode', '26.2k / 1M tokens (3%)', '$0.07']);
  });

  it('leadsWithThePhase_whileATurnIsWorkingOrWaiting', () => {
    phase.set('working');
    fixture.detectChanges();
    expect(segmentsOf(fixture, 1)[0]).toBe('Working');

    phase.set('waiting');
    fixture.detectChanges();
    expect(segmentsOf(fixture, 1)[0]).toBe('Waiting for you');
  });

  it('omitsTheCost_whenTheProviderReportsNone_andCountsBackgroundTasks', () => {
    costUsd.set(0);
    tasks.set(2);
    mode.set('chat');
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual([
      'Chat mode',
      '26.2k / 1M tokens (3%)',
      '2 tasks running',
    ]);
  });

  it('countsTheCommandsRunOutsideTheSandbox_onceThereAreAny', () => {
    fixture.detectChanges();
    expect(segmentsOf(fixture, 1).join(' ')).not.toContain('unsandboxed');

    unsandboxed.set(1);
    fixture.detectChanges();
    expect(segmentsOf(fixture, 1).at(-1)).toBe('1 run unsandboxed');

    unsandboxed.set(3);
    fixture.detectChanges();
    expect(segmentsOf(fixture, 1).at(-1)).toBe('3 runs unsandboxed');
  });

  it('stepsTheTranscriptToTheNextUnsandboxedRun_whenTheCountIsClicked', () => {
    // #1160: the count is a button that asks the conversation to step to the next such command.
    unsandboxed.set(2);
    fixture.detectChanges();

    const button: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'button[data-segment="agent-unsandboxed"]',
    );
    button?.click();
    button?.click();

    expect(button?.title).toContain('Click to go to the next one');
    expect(revealNextUnsandboxed).toHaveBeenCalledTimes(2);
  });

  it('showsTheCountAsText_whereNoConversationIsThereToStepThrough', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: Agent, useValue: agentStub }] });
    fixture = TestBed.createComponent(AgentStatusStrip);
    unsandboxed.set(1);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'button[data-segment="agent-unsandboxed"]',
      ),
    ).toBeNull();
  });

  it('omitsTheCost_onASubscription_whateverTheProviderReports', () => {
    // A subscription is a flat fee: the cost a provider reports for a turn is what it would have been
    // at API prices, not money spent.
    billedPerToken.set(false);
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['Agent mode', '26.2k / 1M tokens (3%)']);
  });

  it('showsNothingOnTheLeft_beforeProvidersLoad', () => {
    providerLabel.set(null);
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual([]);
  });
});
