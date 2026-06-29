import { TestBed } from '@angular/core/testing';

import type { AiEvent, AiPermissionPosture, AiProviderId, AiProviderInfo } from '@shared/ai-types';
import { AgentEngine } from '../agent-engine/agent-engine';
import { AiRuntime, AiRunOptions } from '../ai-runtime/ai-runtime';
import { Settings } from '@shared/angular/services/settings/settings';
import { Agent, AgentItem } from './agent';

/**
 * The providers the stub runtime reports.
 */
const PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude (Agent SDK)',
    available: true,
    detail: 'ok',
    models: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    ],
    defaultModelId: 'claude-opus-4-8',
  },
];

describe('Agent', () => {
  let agent: Agent;
  let runCalls: {
    providerId: AiProviderId;
    prompt: string;
    workspaceRoot: string | null;
    model: string;
    permissionPosture: AiPermissionPosture;
    tokenCap: number;
  }[];
  let abortCalls: string[];
  let permissionReplies: { permissionId: string; granted: boolean }[];
  let fireEvent: (event: AiEvent) => void;

  /**
   * Gets the last transcript item.
   * @returns Returns the last item, or undefined when the transcript is empty.
   */
  function lastItem(): AgentItem | undefined {
    const items: readonly AgentItem[] = agent.items();
    return items[items.length - 1];
  }

  beforeEach(() => {
    localStorage.clear();
    runCalls = [];
    abortCalls = [];
    permissionReplies = [];
    const runtimeStub: Pick<
      AiRuntime,
      'onEvent' | 'run' | 'abort' | 'listProviders' | 'respondPermission'
    > = {
      onEvent: (listener: (event: AiEvent) => void): (() => void) => {
        fireEvent = listener;
        return (): void => undefined;
      },
      run: (providerId: AiProviderId, prompt: string, options: AiRunOptions = {}): string => {
        runCalls.push({
          providerId,
          prompt,
          workspaceRoot: options.workspaceRoot ?? null,
          model: options.model ?? '',
          permissionPosture: options.permissionPosture ?? 'prompt',
          tokenCap: options.tokenCap ?? 0,
        });
        return 'run-1';
      },
      abort: (requestId: string): void => {
        abortCalls.push(requestId);
      },
      listProviders: (): Promise<readonly AiProviderInfo[]> => Promise.resolve(PROVIDERS),
      respondPermission: (permissionId: string, granted: boolean): void => {
        permissionReplies.push({ permissionId, granted });
      },
    };
    TestBed.configureTestingModule({
      providers: [Agent, { provide: AiRuntime, useValue: runtimeStub }],
    });
    agent = TestBed.inject(Agent);
  });

  it('send_whenCalled_pushesAUserItemAndStartsARun', () => {
    agent.send('hello');

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0].providerId).toBe('claude');
    expect(runCalls[0].prompt).toBe('hello');
    expect(runCalls[0].workspaceRoot).toBeNull();
    expect(lastItem()?.kind).toBe('user');
    expect(lastItem()?.text).toBe('hello');
    expect(agent.isRunning()).toBe(true);
  });

  it('send_whenModelSelectedOnTheEngine_forwardsIt', async () => {
    const engine: AgentEngine = TestBed.inject(AgentEngine);
    await engine.loadProviders();
    engine.setModel('claude-sonnet-4-6');

    agent.send('hi');

    expect(runCalls[0].model).toBe('claude-sonnet-4-6');
  });

  it('send_whenPostureAndCapConfigured_forwardsThemFromSettings', () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.setAiPermissionPosture('auto-edits');
    settings.setAiTokenCap(8000);

    agent.send('hi');

    expect(runCalls[0].permissionPosture).toBe('auto-edits');
    expect(runCalls[0].tokenCap).toBe(8000);
  });

  it('send_whenBlank_isIgnored', () => {
    agent.send('   ');

    expect(runCalls).toHaveLength(0);
  });

  it('onText_whenStreamed_appendsToAnAssistantItem', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'Hel' });
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'lo' });

    expect(lastItem()?.kind).toBe('assistant');
    expect(lastItem()?.text).toBe('Hello');
  });

  it('onEvent_whenRequestIdMismatches_isIgnored', () => {
    agent.send('hi');

    fireEvent({ requestId: 'other', kind: 'text', delta: 'nope' });

    expect(lastItem()?.kind).toBe('user');
  });

  it('onTool_whenStartedThenEnded_tracksTheToolState', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'tool-start', toolId: 't1', name: 'Write', detail: 'x' });
    expect(lastItem()?.toolState).toBe('running');

    fireEvent({ requestId: 'run-1', kind: 'tool-end', toolId: 't1', ok: true, detail: 'done' });
    expect(lastItem()?.toolState).toBe('ok');
  });

  it('permission_whenRaisedThenAnswered_resolvesTheItemAndReplies', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'permission',
      permissionId: 'p1',
      name: 'Write',
      detail: 'x',
    });
    expect(agent.awaitingDecision()).toBe(true);

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondPermission(item, true);
    }

    expect(permissionReplies).toEqual([{ permissionId: 'p1', granted: true }]);
    expect(agent.awaitingDecision()).toBe(false);
    expect(lastItem()?.permissionState).toBe('allowed');
  });

  it('status_whenAborted_endsTheRun', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'aborted', detail: '' });

    expect(agent.isRunning()).toBe(false);
  });

  it('status_whenErrorWithDetail_showsTheReason', () => {
    agent.send('hi');

    fireEvent({
      requestId: 'run-1',
      kind: 'status',
      state: 'error',
      detail: 'Ollama is not running.',
    });

    expect(agent.isRunning()).toBe(false);
    expect(lastItem()?.kind).toBe('assistant');
    expect(lastItem()?.text).toBe('_Ollama is not running._');
  });

  it('status_whenErrorWithoutDetail_fallsBackToAGenericMessage', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'error', detail: '' });

    expect(lastItem()?.text).toBe('_The agent run ended with an error._');
  });

  it('status_whenCompletedWithNoOutput_notesIt', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(lastItem()?.kind).toBe('assistant');
    expect(lastItem()?.text).toBe('_The model returned no output._');
  });

  it('status_whenCompletedAfterAReply_doesNotNoteEmptyOutput', () => {
    agent.send('hi');
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'Hello' });

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(lastItem()?.kind).toBe('assistant');
    expect(lastItem()?.text).toBe('Hello');
  });

  it('stop_whenRunning_abortsTheRun', () => {
    agent.send('hi');

    agent.stop();

    expect(abortCalls).toEqual(['run-1']);
  });

  it('clear_whenCalled_emptiesTheTranscript', () => {
    agent.send('hi');

    agent.clear();

    expect(agent.items()).toHaveLength(0);
  });
});
