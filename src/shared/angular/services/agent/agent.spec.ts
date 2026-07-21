import { TestBed } from '@angular/core/testing';

import type {
  AiEvent,
  AiImageRef,
  AiPermissionPosture,
  AiProviderId,
  AiProviderInfo,
} from '@shared/api/ai-types';
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
      { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', contextWindow: 1_000_000 },
    ],
    defaultModelId: 'claude-opus-4-8',
  },
];

describe('Agent', () => {
  let agent: Agent;
  let runCalls: {
    providerId: AiProviderId;
    agentSessionId: string | undefined;
    prompt: string;
    workspaceRoot: string | null;
    model: string;
    permissionPosture: AiPermissionPosture;
    tokenCap: number;
    resumeSessionId: string | null;
    resumeSessionAt: string | null;
    forkSession: boolean;
    images: readonly AiImageRef[];
    runTimeoutMs: number;
  }[];
  let abortCalls: string[];
  let closeSessionCalls: string[];
  let steerCalls: { requestId: string; text: string }[];
  let steerResult: boolean;
  let permissionReplies: { permissionId: string; granted: boolean; remember?: string }[];
  let inputReplies: { inputId: string; answer: string | null }[];
  let editDecisions: { decisionId: string; choice: string }[];
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
    closeSessionCalls = [];
    steerCalls = [];
    steerResult = false;
    permissionReplies = [];
    inputReplies = [];
    editDecisions = [];
    const runtimeStub: Pick<
      AiRuntime,
      | 'onEvent'
      | 'run'
      | 'abort'
      | 'steer'
      | 'closeSession'
      | 'listProviders'
      | 'respondPermission'
      | 'respondInput'
      | 'respondEditDecision'
    > = {
      closeSession: (agentSessionId: string): void => void closeSessionCalls.push(agentSessionId),
      onEvent: (listener: (event: AiEvent) => void): (() => void) => {
        fireEvent = listener;
        return (): void => undefined;
      },
      run: (providerId: AiProviderId, prompt: string, options: AiRunOptions = {}): string => {
        runCalls.push({
          providerId,
          agentSessionId: options.agentSessionId,
          prompt,
          workspaceRoot: options.workspaceRoot ?? null,
          model: options.model ?? '',
          permissionPosture: options.permissionPosture ?? 'prompt',
          tokenCap: options.tokenCap ?? 0,
          resumeSessionId: options.resumeSessionId ?? null,
          resumeSessionAt: options.resumeSessionAt ?? null,
          forkSession: options.forkSession ?? false,
          images: options.images ?? [],
          runTimeoutMs: options.runTimeoutMs ?? 0,
        });
        return 'run-1';
      },
      abort: (requestId: string): void => {
        abortCalls.push(requestId);
      },
      steer: (requestId: string, text: string): Promise<boolean> => {
        steerCalls.push({ requestId, text });
        return Promise.resolve(steerResult);
      },
      listProviders: (): Promise<readonly AiProviderInfo[]> => Promise.resolve(PROVIDERS),
      respondPermission: (permissionId: string, granted: boolean, remember?: string): void => {
        permissionReplies.push(
          remember === undefined ? { permissionId, granted } : { permissionId, granted, remember },
        );
      },
      respondInput: (inputId: string, answer: string | null): void => {
        inputReplies.push({ inputId, answer });
      },
      respondEditDecision: (decisionId: string, choice: string): void => {
        editDecisions.push({ decisionId, choice });
      },
    };
    TestBed.configureTestingModule({
      providers: [Agent, { provide: AiRuntime, useValue: runtimeStub }],
    });
    agent = TestBed.inject(Agent);
  });

  it('send_carriesTheAgentSessionId', () => {
    agent.send('hello');

    expect(runCalls[0].agentSessionId).toBeTruthy();
  });

  it('clear_closesTheLiveSessionAndMintsAFreshOne', () => {
    agent.send('hello');
    const first: string | undefined = runCalls[0].agentSessionId;

    agent.clear();
    agent.send('fresh');

    expect(closeSessionCalls).toContain(first);
    expect(runCalls[1].agentSessionId).not.toBe(first);
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
    // The default wall-clock budget (10 minutes) rides every run in milliseconds.
    expect(runCalls[0].runTimeoutMs).toBe(600_000);
  });

  it('send_whenTheRunTimeLimitIsChanged_forwardsItInMilliseconds', () => {
    TestBed.inject(Settings).set('ai.runTimeoutMinutes', 2);

    agent.send('hi');

    expect(runCalls[0].runTimeoutMs).toBe(120_000);
  });

  it('send_whenBlank_isIgnored', () => {
    agent.send('   ');

    expect(runCalls).toHaveLength(0);
  });

  it('hasMessages_isFalseUntilTheTranscriptHasAnItem', () => {
    expect(agent.hasMessages()).toBe(false);

    agent.send('hi');

    expect(agent.hasMessages()).toBe(true);
  });

  it('hasMessages_whenTheSendIsBlankAndIgnored_staysFalse', () => {
    agent.send('   ');

    expect(agent.hasMessages()).toBe(false);
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

  it('onTool_whenPayloadsAreCarried_storesTheRawInputAndOutput', () => {
    agent.send('hi');

    fireEvent({
      requestId: 'run-1',
      kind: 'tool-start',
      toolId: 't1',
      name: 'Bash',
      detail: 'ls',
      input: '{\n  "command": "ls"\n}',
    });
    expect(lastItem()?.toolInput).toBe('{\n  "command": "ls"\n}');

    fireEvent({
      requestId: 'run-1',
      kind: 'tool-end',
      toolId: 't1',
      ok: false,
      detail: 'failed',
      output: 'ls: no such directory',
    });
    expect(lastItem()?.toolState).toBe('error');
    expect(lastItem()?.toolOutput).toBe('ls: no such directory');
  });

  it('permission_whenRaisedThenAnswered_resolvesTheItemAndReplies', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'permission',
      permissionId: 'p1',
      name: 'Write',
      detail: 'x',
      hasWorkspace: true,
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
    expect(lastItem()?.permissionHasWorkspace).toBe(true);
  });

  it('permission_whenGrantedWithARememberScope_forwardsAndRecordsIt', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'permission',
      permissionId: 'p1',
      name: 'Bash',
      detail: 'ls',
      hasWorkspace: true,
    });

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondPermission(item, true, 'workspace');
    }

    expect(permissionReplies).toEqual([
      { permissionId: 'p1', granted: true, remember: 'workspace' },
    ]);
    expect(lastItem()?.permissionRemember).toBe('workspace');
  });

  it('permission_whenDeniedWithARememberScope_dropsTheScope', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'permission',
      permissionId: 'p1',
      name: 'Bash',
      detail: 'ls',
      hasWorkspace: false,
    });

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondPermission(item, false, 'always');
    }

    expect(permissionReplies).toEqual([{ permissionId: 'p1', granted: false }]);
    expect(lastItem()?.permissionState).toBe('denied');
    expect(lastItem()?.permissionRemember).toBeUndefined();
  });

  it('inputRequest_whenRaised_pushesAPendingQuestionAndAwaitsTheUser', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'input-request',
      inputId: 'q1',
      question: 'Which approach?',
      choices: [{ label: 'A', description: 'the safe one (recommended)' }, { label: 'B' }],
    });

    expect(agent.awaitingDecision()).toBe(true);
    expect(agent.pendingInput()?.inputQuestion).toBe('Which approach?');
    expect(agent.pendingInput()?.inputChoices).toEqual([
      { label: 'A', description: 'the safe one (recommended)' },
      { label: 'B' },
    ]);
    expect(lastItem()?.inputState).toBe('pending');
  });

  it('respondInput_whenAnswered_repliesAndSettlesTheItem', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'input-request',
      inputId: 'q1',
      question: 'Name?',
      choices: [],
    });

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondInput(item, 'orders-db');
    }

    expect(inputReplies).toEqual([{ inputId: 'q1', answer: 'orders-db' }]);
    expect(agent.awaitingDecision()).toBe(false);
    expect(agent.pendingInput()).toBeUndefined();
    expect(lastItem()?.inputState).toBe('answered');
    expect(lastItem()?.inputAnswer).toBe('orders-db');
  });

  it('respondInput_whenDeclined_repliesNullAndDismissesTheItem', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'input-request',
      inputId: 'q1',
      question: 'Name?',
      choices: [],
    });

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondInput(item, null);
    }

    expect(inputReplies).toEqual([{ inputId: 'q1', answer: null }]);
    expect(lastItem()?.inputState).toBe('dismissed');
  });

  it('respondInput_whenAlreadySettled_isIgnored', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'input-request',
      inputId: 'q1',
      question: 'Name?',
      choices: [],
    });
    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondInput(item, 'first');
      agent.respondInput({ ...item, inputState: 'answered' }, 'second');
    }

    expect(inputReplies).toHaveLength(1);
  });

  it('status_whenRunEndsWithAPendingQuestion_dismissesIt', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'input-request',
      inputId: 'q1',
      question: 'Name?',
      choices: [],
    });

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'aborted', detail: '' });

    expect(agent.pendingInput()).toBeUndefined();
    const question: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.kind === 'input-request');
    expect(question?.inputState).toBe('dismissed');
  });

  it('restore_whenAQuestionWasPersistedPending_normalisesItToDismissed', () => {
    agent.restore([
      { id: 'item-1', kind: 'user', text: 'hi' },
      {
        id: 'item-2',
        kind: 'input-request',
        text: '',
        inputId: 'q1',
        inputQuestion: 'Name?',
        inputChoices: [],
        inputState: 'pending',
      },
    ]);

    expect(agent.pendingInput()).toBeUndefined();
    const question: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.kind === 'input-request');
    expect(question?.inputState).toBe('dismissed');
  });

  it('restore_whenChoicesWerePersistedAsStrings_liftsThemToLabelledChoices', () => {
    agent.restore([
      {
        id: 'item-1',
        kind: 'input-request',
        text: '',
        inputId: 'q1',
        inputQuestion: 'Which approach?',
        inputChoices: ['A', 'B'] as unknown as AgentItem['inputChoices'],
        inputState: 'answered',
        inputAnswer: 'A',
      },
    ]);

    const question: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.kind === 'input-request');
    expect(question?.inputChoices).toEqual([{ label: 'A' }, { label: 'B' }]);
  });

  it('subagent_whenTextIsAttributed_doesNotMergeIntoTheTopLevelStream', () => {
    agent.send('hi');
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'top-level' });
    fireEvent({
      requestId: 'run-1',
      kind: 'tool-start',
      toolId: 'task-1',
      name: 'Task',
      detail: 'Explore the repo',
      agentType: 'Explore',
    });
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'nested', parentToolId: 'task-1' });

    const items: readonly AgentItem[] = agent.items();
    const top: AgentItem | undefined = items.find(
      (item: AgentItem): boolean => item.kind === 'assistant' && item.parentToolId === undefined,
    );
    const nested: AgentItem | undefined = items.find(
      (item: AgentItem): boolean => item.parentToolId === 'task-1' && item.kind === 'assistant',
    );
    const task: AgentItem | undefined = items.find(
      (item: AgentItem): boolean => item.toolId === 'task-1',
    );
    expect(top?.text).toBe('top-level');
    expect(nested?.text).toBe('nested');
    expect(task?.agentType).toBe('Explore');
  });

  it('subagent_whenToolsRun_attributesThemToTheirLane', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'tool-start',
      toolId: 'task-1',
      name: 'Task',
      detail: 'Explore',
      agentType: 'Explore',
    });
    fireEvent({
      requestId: 'run-1',
      kind: 'tool-start',
      toolId: 't2',
      name: 'Grep',
      detail: 'pattern',
      parentToolId: 'task-1',
    });
    fireEvent({
      requestId: 'run-1',
      kind: 'tool-end',
      toolId: 't2',
      ok: true,
      detail: 'done',
      parentToolId: 'task-1',
    });

    const nestedTool: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.toolId === 't2');
    expect(nestedTool?.parentToolId).toBe('task-1');
    expect(nestedTool?.toolState).toBe('ok');
  });

  it('subagentUsage_whenReported_snapshotsOnTheLaneNotTheContextMeter', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'tool-start',
      toolId: 'task-1',
      name: 'Task',
      detail: 'Explore',
      agentType: 'Explore',
    });

    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      parentToolId: 'task-1',
      inputTokens: 4000,
      outputTokens: 100,
      costUsd: null,
    });
    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      parentToolId: 'task-1',
      inputTokens: 5000,
      outputTokens: 200,
      costUsd: null,
    });

    // The lane reflects the sub-agent's latest occupancy snapshot (5000 + 200), not the sum of every
    // round-trip's re-sent context — accumulating would re-count the cached context each round-trip.
    const task: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.toolId === 'task-1');
    expect(task?.agentTokens).toBe(5200);
    expect(agent.contextTokens()).toBe(0);

    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 12_000,
      outputTokens: 500,
      costUsd: 0.05,
    });
    expect(agent.contextTokens()).toBe(12_500);
  });

  it('editDecision_whenRaisedThenApplied_repliesAndSettlesTheItem', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'edit-decision',
      decisionId: 'd1',
      name: 'the active document',
      detail: '+2 lines, +40 characters',
      hasDiff: true,
    });
    expect(agent.awaitingDecision()).toBe(true);

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondEditDecision(item, 'yes-auto');
    }

    expect(editDecisions).toEqual([{ decisionId: 'd1', choice: 'yes-auto' }]);
    expect(agent.awaitingDecision()).toBe(false);
    expect(lastItem()?.decisionState).toBe('applied');
    expect(lastItem()?.decisionAuto).toBe(true);
  });

  it('editDecision_whenRejected_settlesRejected', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'edit-decision',
      decisionId: 'd1',
      name: 'the markdown document',
      detail: '',
      hasDiff: false,
    });

    const item: AgentItem | undefined = lastItem();
    expect(item).toBeDefined();
    if (item !== undefined) {
      agent.respondEditDecision(item, 'no');
    }

    expect(editDecisions).toEqual([{ decisionId: 'd1', choice: 'no' }]);
    expect(lastItem()?.decisionState).toBe('rejected');
    expect(lastItem()?.decisionHasDiff).toBe(false);
  });

  it('status_whenRunEndsWithAPendingEditDecision_dismissesIt', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'edit-decision',
      decisionId: 'd1',
      name: 'the active document',
      detail: '',
      hasDiff: true,
    });

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'aborted', detail: '' });

    const decision: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.kind === 'edit-decision');
    expect(decision?.decisionState).toBe('dismissed');
    expect(agent.awaitingDecision()).toBe(false);
  });

  it('status_whenAborted_endsTheRun', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'aborted', detail: '' });

    expect(agent.isRunning()).toBe(false);
  });

  it('status_whenErrorWithDetail_foldsAStructuredErrorItem', () => {
    agent.send('hi');

    fireEvent({
      requestId: 'run-1',
      kind: 'status',
      state: 'error',
      detail: 'Ollama is not running.',
    });

    expect(agent.isRunning()).toBe(false);
    expect(lastItem()?.kind).toBe('error');
    expect(lastItem()?.text).toBe('Ollama is not running.');
    expect(lastItem()?.errorPrompt).toBe('hi');
    // A one-line reason carries everything; there are no extra diagnostics.
    expect(lastItem()?.errorDetail).toBeUndefined();
  });

  it('status_whenErrorWithoutDetail_fallsBackToAGenericMessage', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'error', detail: '' });

    expect(lastItem()?.kind).toBe('error');
    expect(lastItem()?.text).toBe('The agent run ended with an error.');
  });

  it('status_whenErrorIsMultiLine_splitsTheCauseFromTheDiagnostics', () => {
    agent.send('hi');

    fireEvent({
      requestId: 'run-1',
      kind: 'status',
      state: 'error',
      detail: 'Request failed with status 529\n{"type":"overloaded_error"}',
    });

    expect(lastItem()?.text).toBe('Request failed with status 529');
    expect(lastItem()?.errorDetail).toBe(
      'Request failed with status 529\n{"type":"overloaded_error"}',
    );
  });

  it('status_whenErrorFollowsAFailedTool_capturesTheToolContext', () => {
    agent.send('hi');
    fireEvent({ requestId: 'run-1', kind: 'tool-start', toolId: 't1', name: 'Bash', detail: 'ls' });
    fireEvent({
      requestId: 'run-1',
      kind: 'tool-end',
      toolId: 't1',
      ok: false,
      detail: 'failed',
      output: 'command not found',
    });

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'error', detail: 'The run failed.' });

    expect(lastItem()?.errorToolContext).toBe('Bash: command not found');
  });

  it('retry_whenClicked_reRunsTheFailedTurnWithoutDuplicatingTheUserMessage', () => {
    agent.send('do the thing');
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'error', detail: 'boom' });
    const errorItem: AgentItem = lastItem()!;
    const itemsBefore: number = agent.items().length;

    agent.retry(errorItem);

    expect(runCalls).toHaveLength(2);
    expect(runCalls[1].prompt).toBe('do the thing');
    expect(agent.isRunning()).toBe(true);
    expect(agent.items()).toHaveLength(itemsBefore);
    const retried: AgentItem | undefined = agent
      .items()
      .find((item: AgentItem): boolean => item.id === errorItem.id);
    expect(retried?.errorRetried).toBe(true);

    // A spent retry does not fire again, even once the re-run has ended.
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    agent.retry(retried!);
    expect(runCalls).toHaveLength(2);
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

  it('send_whileRunningAndSteerAccepted_injectsIntoTheRunWithoutQueueing', async () => {
    steerResult = true;
    agent.send('first');

    agent.send('also do this');
    await Promise.resolve();
    await Promise.resolve();

    expect(steerCalls).toEqual([{ requestId: 'run-1', text: 'also do this' }]);
    expect(agent.queued()).toHaveLength(0);
    expect(runCalls).toHaveLength(1);
    expect(lastItem()?.kind).toBe('user');
    expect(lastItem()?.text).toBe('also do this');
  });

  it('send_whileRunningAndSteerRefused_queuesAndDispatchesOnCompletion', async () => {
    agent.send('first');

    agent.send('follow-up');
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.queued()).toHaveLength(1);
    expect(agent.queued()[0].text).toBe('follow-up');
    // The queued message is not yet in the transcript.
    expect(lastItem()?.text).toBe('first');

    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'done first' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(agent.queued()).toHaveLength(0);
    expect(runCalls).toHaveLength(2);
    expect(runCalls[1].prompt).toBe('follow-up');
    expect(agent.isRunning()).toBe(true);
    expect(lastItem()?.kind).toBe('user');
    expect(lastItem()?.text).toBe('follow-up');
  });

  it('queue_whenTheRunFailsOrAborts_isHeldRatherThanDispatched', async () => {
    agent.send('first');
    agent.send('follow-up');
    await Promise.resolve();
    await Promise.resolve();

    fireEvent({ requestId: 'run-1', kind: 'status', state: 'aborted', detail: '' });

    expect(agent.queued()).toHaveLength(1);
    expect(runCalls).toHaveLength(1);
  });

  it('queue_whenEntriesAreRemovedOrTaken_editsBeforeDispatch', async () => {
    agent.send('first');
    agent.send('one');
    agent.send('two');
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.queued()).toHaveLength(2);

    const taken: string | null = agent.takeQueued(agent.queued()[0].id);
    expect(taken).toBe('one');
    agent.removeQueued(agent.queued()[0].id);

    expect(agent.queued()).toHaveLength(0);
  });

  it('restore_whenAQueueWasPersisted_rehydratesItForTheNextCompletedRun', () => {
    agent.restore([{ id: 'item-1', kind: 'user', text: 'hi' }], null, ['queued follow-up']);

    expect(agent.queued()).toHaveLength(1);
    expect(agent.queued()[0].text).toBe('queued follow-up');

    // The queue drains after the next completed run.
    agent.send('go');
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'ok' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(agent.queued()).toHaveLength(0);
    expect(runCalls).toHaveLength(2);
    expect(runCalls[1].prompt).toBe('queued follow-up');
  });

  it('send_whenImagesAttached_carriesThemOnTheItemAndTheRun', () => {
    const image: AiImageRef = { mediaType: 'image/png', data: 'aWJt', name: 'shot.png' };

    agent.send('what is wrong in this screenshot?', undefined, undefined, [image]);

    expect(lastItem()?.kind).toBe('user');
    expect(lastItem()?.images).toEqual([image]);
    expect(runCalls[0].images).toEqual([image]);
  });

  it('send_whileRunningWithImages_queuesWithoutAttemptingToSteer', async () => {
    steerResult = true;
    const image: AiImageRef = { mediaType: 'image/png', data: 'aWJt' };
    agent.send('first');

    agent.send('look at this', undefined, undefined, [image]);
    await Promise.resolve();
    await Promise.resolve();

    // The steer channel is text-only: an image-carrying message queues directly.
    expect(steerCalls).toEqual([]);
    expect(agent.queued()).toHaveLength(1);

    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'ok' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(runCalls[1].images).toEqual([image]);
    expect(lastItem()?.images).toEqual([image]);
  });

  it('onText_whenChunksCarryAMessageUuid_recordsTheBranchAnchor', () => {
    agent.send('hi');

    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'Hel', messageUuid: 'uuid-1' });
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'lo', messageUuid: 'uuid-1' });

    expect(lastItem()?.text).toBe('Hello');
    expect(lastItem()?.providerMessageId).toBe('uuid-1');
  });

  it('rewind_whenEditingAPriorMessage_truncatesAndForksTheSessionAtTheKeptAnchor', () => {
    agent.send('first');
    fireEvent({ requestId: 'run-1', kind: 'session', sessionId: 'sess-1' });
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'reply one', messageUuid: 'uuid-1' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    agent.send('second');
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'reply two', messageUuid: 'uuid-2' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    const secondUser: AgentItem = agent
      .items()
      .filter((item: AgentItem): boolean => item.kind === 'user')[1];

    agent.rewind(secondUser, 'second, but better');

    // The transcript keeps only the items before the rewind point, plus the edited message.
    expect(agent.items().map((item: AgentItem): string => item.text)).toEqual([
      'first',
      'reply one',
      'second, but better',
    ]);
    // The original line is published as a branch point for the hosting conversation to preserve.
    expect(agent.branch().epoch).toBe(1);
    expect(agent.branch().origin).toHaveLength(4);
    expect(agent.branch().originSessionId).toBe('sess-1');
    // The re-run forks the session resumed up to the last kept assistant message.
    expect(runCalls).toHaveLength(3);
    expect(runCalls[2].prompt).toBe('second, but better');
    expect(runCalls[2].resumeSessionId).toBe('sess-1');
    expect(runCalls[2].resumeSessionAt).toBe('uuid-1');
    expect(runCalls[2].forkSession).toBe(true);
    // The fork anchor is consumed: a later ordinary send does not fork again.
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'better reply' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    agent.send('carry on');
    expect(runCalls[3].forkSession).toBe(false);
    expect(runCalls[3].resumeSessionAt).toBeNull();
  });

  it('rewind_whenNoAnchorRemains_startsAFreshSession', () => {
    agent.send('first');
    fireEvent({ requestId: 'run-1', kind: 'session', sessionId: 'sess-1' });
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'reply', messageUuid: 'uuid-1' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    const firstUser: AgentItem = agent
      .items()
      .find((item: AgentItem): boolean => item.kind === 'user')!;

    agent.rewind(firstUser, 'a different opening');

    // Nothing kept before the rewind point: the branch must not resume a session that still
    // contains the discarded turns.
    expect(runCalls[1].resumeSessionId).toBeNull();
    expect(runCalls[1].forkSession).toBe(false);
    expect(agent.items().map((item: AgentItem): string => item.text)).toEqual([
      'a different opening',
    ]);
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

  it('send_onAFreshConversation_resumesNoSession', () => {
    agent.send('hi');

    expect(runCalls[0].resumeSessionId).toBeNull();
  });

  it('session_whenReceived_isSentAsResumeOnTheNextTurn', () => {
    agent.send('first');
    fireEvent({ requestId: 'run-1', kind: 'session', sessionId: 'sess-abc' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    agent.send('second');

    expect(runCalls).toHaveLength(2);
    expect(runCalls[1].resumeSessionId).toBe('sess-abc');
  });

  it('clear_whenCalled_forgetsTheSession', () => {
    agent.send('first');
    fireEvent({ requestId: 'run-1', kind: 'session', sessionId: 'sess-abc' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    agent.clear();
    agent.send('fresh');

    expect(runCalls[1].resumeSessionId).toBeNull();
  });

  it('restore_whenGivenASession_resumesItOnTheNextTurn', () => {
    agent.restore([{ id: 'item-1', kind: 'user', text: 'earlier' }], 'sess-restored');

    agent.send('again');

    expect(runCalls[0].resumeSessionId).toBe('sess-restored');
  });

  it('restore_whenCalled_replacesTheTranscriptAndReseedsItemIds', () => {
    const items: AgentItem[] = [
      { id: 'item-3', kind: 'user', text: 'earlier' },
      { id: 'item-4', kind: 'assistant', text: 'reply' },
    ];

    agent.restore(items);

    expect(agent.items()).toHaveLength(2);
    expect(agent.items()[0].text).toBe('earlier');

    // A subsequent send appends past the restored maximum id (item-4 → item-5), not colliding.
    agent.send('again');

    expect(lastItem()?.kind).toBe('user');
    expect(lastItem()?.id).toBe('item-5');
  });

  it('usage_whenReported_setsContextTokensToInputPlusOutputAndAccumulatesCost', () => {
    agent.send('hi');

    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.02,
    });

    expect(agent.contextTokens()).toBe(1500);
    expect(agent.costUsd()).toBeCloseTo(0.02, 5);
  });

  it('usage_whenReportedAcrossTurns_replacesContextButAccumulatesCost', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.01,
    });
    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 4000,
      outputTokens: 500,
      costUsd: 0.03,
    });

    // The latest turn's input already re-sends the whole context, so context is replaced, not summed.
    expect(agent.contextTokens()).toBe(4500);
    // Cost is real spend and accumulates.
    expect(agent.costUsd()).toBeCloseTo(0.04, 5);
  });

  it('usage_whenCostIsNull_leavesCostUnchanged', () => {
    agent.send('hi');

    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 800,
      outputTokens: 100,
      costUsd: null,
    });

    expect(agent.contextTokens()).toBe(900);
    expect(agent.costUsd()).toBe(0);
  });

  it('clear_whenCalled_resetsTheContextAndCostReadout', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.05,
    });

    agent.clear();

    expect(agent.contextTokens()).toBe(0);
    expect(agent.costUsd()).toBe(0);
  });

  it('compact_whenSuccessful_dropsTheContextReadoutToZero', () => {
    agent.send('hi');
    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 5000,
      outputTokens: 500,
      costUsd: 0.05,
    });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    agent.compact();
    // A compaction run's own usage must not spike the meter; it is ignored while compacting.
    fireEvent({
      requestId: 'run-1',
      kind: 'usage',
      inputTokens: 5500,
      outputTokens: 400,
      costUsd: 0.02,
    });
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'Summary of the chat.' });
    fireEvent({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(agent.contextTokens()).toBe(0);
    // The summary replaced the transcript, so the meter refills from the next real turn.
    expect(agent.items()).toHaveLength(1);
  });
});
