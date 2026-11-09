import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiEvent, AiProviderInfo } from '@shared/api/ai-types';
import { AiRunOptions, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Settings } from '@shared/angular/services/settings/settings';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { AutoConfigureOutcome, RunConfigurationAgent } from './run-configuration-agent';

/**
 * Stands in for the agent runtime, recording what it is asked and emitting what a test tells it to.
 */
class FakeRuntime {
  public providers: AiProviderInfo[] = [
    { id: 'first', label: 'First', available: false } as AiProviderInfo,
    { id: 'second', label: 'Second', available: true } as AiProviderInfo,
    { id: 'third', label: 'Third', available: true } as AiProviderInfo,
  ];
  public readonly runs: { provider: string; prompt: string; options: AiRunOptions }[] = [];
  public readonly aborted: string[] = [];
  public readonly closed: string[] = [];
  public readonly permissions: [string, boolean][] = [];
  public readonly inputs: [string, string | null][] = [];
  private listener: ((event: AiEvent) => void) | null = null;

  public listProviders(): Promise<AiProviderInfo[]> {
    return Promise.resolve(this.providers);
  }

  public run(provider: string, prompt: string, options: AiRunOptions): string {
    this.runs.push({ provider, prompt, options });
    return 'run-1';
  }

  public onEvent(listener: (event: AiEvent) => void): () => void {
    this.listener = listener;
    return (): void => {
      this.listener = null;
    };
  }

  public abort(requestId: string): void {
    this.aborted.push(requestId);
  }

  public closeSession(session: string): void {
    this.closed.push(session);
  }

  public respondPermission(permissionId: string, granted: boolean): void {
    this.permissions.push([permissionId, granted]);
  }

  public respondInput(inputId: string, answer: string | null): void {
    this.inputs.push([inputId, answer]);
  }

  public emit(event: Record<string, unknown>): void {
    this.listener?.({ requestId: 'run-1', ...event } as unknown as AiEvent);
  }

  public get listening(): boolean {
    return this.listener !== null;
  }
}

describe('RunConfigurationAgent', () => {
  let runtime: FakeRuntime;
  let root: WritableSignal<string | null>;
  let agent: RunConfigurationAgent;

  /**
   * Waits for a started run to reach the runtime.
   */
  async function started(): Promise<void> {
    await vi.waitFor((): void => {
      expect(runtime.runs).toHaveLength(1);
    });
  }

  beforeEach(() => {
    runtime = new FakeRuntime();
    root = signal<string | null>('/workspace');
    TestBed.configureTestingModule({
      providers: [
        RunConfigurationAgent,
        { provide: AiRuntime, useValue: runtime },
        { provide: ActiveWorkspace, useValue: { rootPath: root } },
        {
          provide: Settings,
          useValue: {
            aiConnections: (): readonly unknown[] => [],
            aiActiveConnectionId: (): string => 'third',
          },
        },
      ],
    });
    agent = TestBed.inject(RunConfigurationAgent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refusesToRun_withNoWorkspaceOpen', async () => {
    root.set(null);

    const outcome: AutoConfigureOutcome = await agent.configure();

    expect(outcome.status).toBe('failed');
    expect(runtime.runs).toEqual([]);
  });

  it('saysSo_whenNoProviderIsAvailable', async () => {
    runtime.providers = [];

    const outcome: AutoConfigureOutcome = await agent.configure();

    expect(outcome).toEqual({
      status: 'failed',
      message: 'No AI provider is available. Set one up in Settings, then try again.',
    });
    expect(agent.running()).toBe(false);
  });

  it('runsAsItsOwnAgent_inItsOwnSession_notTheWorkspaces', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    const { options } = runtime.runs[0];
    expect(options.agentSessionId).toMatch(/^auto-configure-/);
    expect(options.workspaceRoot).toBe('/workspace');
    // The run-configuration tools are offered on workspace surfaces only.
    expect(options.surface).toBe('workspace');
    expect(options.mode).toBe('agent');

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('usesTheActiveConnection_whenItCanRun', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    expect(runtime.runs[0].provider).toBe('third');

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('fallsBackToTheFirstAvailableProvider', async () => {
    runtime.providers = runtime.providers.slice(0, 2);
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    expect(runtime.runs[0].provider).toBe('second');

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('tellsTheAgentToPickADefault_andNotToAskQuestions', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    expect(runtime.runs[0].prompt).toContain('Set `default: true` on exactly one configuration');
    expect(runtime.runs[0].prompt).toContain('do not ask any');

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('completes_runningUntilThen_andClosesItsSession', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();
    expect(agent.running()).toBe(true);

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });

    expect(await pending).toEqual({ status: 'completed' });
    expect(agent.running()).toBe(false);
    expect(runtime.closed).toEqual([runtime.runs[0].options.agentSessionId]);
    expect(runtime.listening).toBe(false);
  });

  it('reportsARunThatFails', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    runtime.emit({ kind: 'status', state: 'error', detail: 'boom' });

    expect((await pending).status).toBe('failed');
    expect(runtime.closed).toHaveLength(1);
  });

  it('ignoresAnotherRunsEvents', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    runtime.emit({ requestId: 'run-2', kind: 'status', state: 'completed', detail: '' });
    expect(agent.running()).toBe(true);

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('grantsTheRunConfigurationTools_andRefusesEverythingElse', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    runtime.emit({ kind: 'permission', permissionId: 'a', name: 'save_run_configurations' });
    runtime.emit({
      kind: 'permission',
      permissionId: 'b',
      name: 'mcp__studio__delete_run_configurations',
    });
    runtime.emit({ kind: 'permission', permissionId: 'c', name: 'Bash' });
    runtime.emit({ kind: 'permission', permissionId: 'd', name: 'Write' });

    expect(runtime.permissions).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
      ['d', false],
    ]);

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('answersAQuestionWithSilence_soTheRunCannotWaitForever', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    runtime.emit({ kind: 'input-request', inputId: 'q', question: 'Which one?' });

    expect(runtime.inputs).toEqual([['q', null]]);

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('cancel_abortsTheRun_andClosesItsSession', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    agent.cancel();

    expect(await pending).toEqual({ status: 'cancelled' });
    expect(runtime.aborted).toEqual(['run-1']);
    expect(runtime.closed).toHaveLength(1);
  });

  it('cancel_beforeTheProviderIsChosen_startsNothing', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();

    agent.cancel();

    expect(await pending).toEqual({ status: 'cancelled' });
    expect(runtime.runs).toEqual([]);
  });

  it('refusesASecondRun_whileOneIsGoing', async () => {
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await started();

    expect((await agent.configure()).status).toBe('failed');
    expect(runtime.runs).toHaveLength(1);

    runtime.emit({ kind: 'status', state: 'completed', detail: '' });
    await pending;
  });

  it('abandonsARunThatStalls', async () => {
    vi.useFakeTimers();
    const pending: Promise<AutoConfigureOutcome> = agent.configure();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.runs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect((await pending).status).toBe('failed');
    expect(runtime.aborted).toEqual(['run-1']);
    expect(runtime.closed).toHaveLength(1);
  });
});
