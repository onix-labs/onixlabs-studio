import { beforeEach, describe, expect, it } from 'vitest';
import type { AppServerConnection, AppServerHandlers, AppServerProcess } from './app-server';
import { CodexClient, STUDIO_TOKEN_VARIABLE } from './codex-client';
import { policyFor, type TurnPolicy } from './policy';
import type { StudioTool, TurnRequest } from './protocol';
import type { StudioMcpServer, StudioToolBridge } from './studio-mcp';

/**
 * One fake app-server process: what it was started with, what it was asked, and whether it stopped.
 */
interface FakeProcess extends AppServerProcess {
  readonly executable: string;
  readonly env: Readonly<Record<string, string>>;
  readonly handlers: AppServerHandlers;
  readonly requests: { method: string; params: Record<string, unknown> }[];
  stopped: boolean;
}

/**
 * Builds a turn, as Studio sends one, with overrides.
 * @param overrides The fields to change.
 * @returns Returns the turn.
 */
function turn(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    requestId: 'run-1',
    prompt: 'hello',
    workspaceRoot: '/ws',
    model: 'gpt-5.6-terra',
    agentSessionId: 'agent-1',
    effort: null,
    mode: 'agent',
    surface: 'workspace',
    allowedWritePaths: [],
    deniedWritePaths: [],
    allowedNetworkLocations: [],
    deniedNetworkLocations: [],
    tokenCap: 0,
    resumeSessionId: null,
    forkSession: false,
    resumeSessionAt: null,
    permissionPosture: 'prompt',
    toolPolicies: {},
    images: [],
    contextPaths: [],
    remoteControl: 'off',
    agentShell: null,
    owningTabId: null,
    providerSettings: {},
    ...overrides,
  };
}

describe('the Codex client, when Studio changes its instructions between turns (#955)', () => {
  const policy: TurnPolicy = policyFor(turn());
  let processes: FakeProcess[];
  let toolServers: { closed: boolean }[];
  let sessions: string[];
  let notes: string[];
  let lost: (Error | null)[];
  let resumeFails: boolean;
  let started: number;
  let initializeFails: boolean;

  /**
   * Builds a client whose app-servers and tool servers are fakes that record what they are asked.
   * @returns Returns the client.
   */
  function client(): CodexClient {
    const bridge: StudioToolBridge = {
      describe: (): Promise<readonly StudioTool[]> => Promise.resolve([]),
      invoke: () => Promise.resolve({ result: null, error: null }),
    };
    return new CodexClient({
      // A choice naming a path is the user's own Codex; anything else is the bundled copy.
      findExecutable: (choice: unknown): { path: string; own: boolean } => {
        const own: unknown = (choice as { path?: unknown } | undefined)?.path;
        return typeof own === 'string'
          ? { path: own, own: true }
          : { path: '/bin/codex', own: false };
      },
      spawn: (
        executable: string,
        env: Readonly<Record<string, string>>,
        handlers: AppServerHandlers,
      ): AppServerProcess => {
        const fake: FakeProcess = {
          executable,
          env,
          handlers,
          requests: [],
          stopped: false,
          connection: {
            request: (method: string, params: unknown): Promise<unknown> => {
              const body: Record<string, unknown> = params as Record<string, unknown>;
              fake.requests.push({ method, params: body });
              if (method === 'initialize' && initializeFails) {
                return Promise.reject(new Error('unknown subcommand app-server'));
              }
              if (method === 'thread/resume' && resumeFails) {
                return Promise.reject(new Error('no rollout found'));
              }
              if (method === 'thread/start') {
                started += 1;
                return Promise.resolve({ thread: { id: `thread-${started}` } });
              }
              if (method === 'thread/resume') {
                return Promise.resolve({ thread: { id: body['threadId'] } });
              }
              return Promise.resolve({});
            },
            close: (): void => undefined,
          } satisfies AppServerConnection,
          stop: (): void => {
            fake.stopped = true;
            // As the real one does: closing the connection reports the close.
            handlers.onClose(null);
          },
        };
        processes.push(fake);
        return fake;
      },
      startTools: (): Promise<StudioMcpServer> => {
        const server: { closed: boolean } = { closed: false };
        toolServers.push(server);
        return Promise.resolve({
          url: `http://127.0.0.1:4000${toolServers.length}/mcp`,
          token: `token-${toolServers.length}`,
          close: (): void => {
            server.closed = true;
          },
        });
      },
      bridge,
      apiKey: (): Promise<string | null> => Promise.resolve(null),
      onNotification: (): void => undefined,
      onRequest: (): Promise<unknown> => Promise.resolve(null),
      onLost: (error: Error | null): void => {
        lost.push(error);
      },
      onSession: (_requestId: string, threadId: string): void => {
        sessions.push(threadId);
      },
      note: (message: string): void => {
        notes.push(message);
      },
    });
  }

  /**
   * Runs one turn as the harness does: the server, then the thread with the offered text, then —
   * unless the turn fails — the completion that tells the client Codex has persisted the thread.
   * @param codex The client.
   * @param instructions The instructions Studio offers this turn.
   * @param completes Whether the turn runs to completion.
   * @returns Returns the thread id.
   */
  async function startOfTurn(
    codex: CodexClient,
    instructions: string,
    completes: boolean = true,
    choice?: unknown,
  ): Promise<string> {
    await codex.ensureServer('run-1', choice);
    const id: string = await codex.ensureThread(turn(), policy, instructions);
    if (completes) {
      codex.turnCompleted();
    }
    return id;
  }

  /**
   * Gets the thread-opening requests across every process, in order.
   * @returns Returns them.
   */
  function threadRequests(): { method: string; params: Record<string, unknown> }[] {
    return processes.flatMap((fake: FakeProcess) =>
      fake.requests.filter((request) => request.method.startsWith('thread/')),
    );
  }

  beforeEach(() => {
    processes = [];
    toolServers = [];
    sessions = [];
    notes = [];
    lost = [];
    resumeFails = false;
    started = 0;
    initializeFails = false;
  });

  it('aChangedCodexCli_restartsCodexOnTheChosenBinary_andResumesTheThreadOnce (#1079)', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'Be brief.');
    const id: string = await startOfTurn(codex, 'Be brief.', true, {
      mode: 'custom',
      path: '/opt/codex',
    });

    // One restart, on the chosen binary, and the conversation carries on there.
    expect(id).toBe('thread-1');
    expect(processes.map((fake: FakeProcess) => fake.executable)).toEqual([
      '/bin/codex',
      '/opt/codex',
    ]);
    expect(processes[0].stopped).toBe(true);
    expect(threadRequests().map((request) => request.method)).toEqual([
      'thread/start',
      'thread/resume',
    ]);
    expect(threadRequests()[1].params['threadId']).toBe('thread-1');
    expect(lost).toEqual([]);
  });

  it('theSameCodexCli_keepsTheRunningServer (#1079)', async () => {
    const codex: CodexClient = client();
    const choice: unknown = { mode: 'custom', path: '/opt/codex' };
    await startOfTurn(codex, 'Be brief.', true, choice);
    await startOfTurn(codex, 'Be brief.', true, choice);

    expect(processes).toHaveLength(1);
    expect(processes[0].executable).toBe('/opt/codex');
  });

  it('aReloadForNewInstructions_keepsTheChosenCodex (#1079)', async () => {
    const codex: CodexClient = client();
    const choice: unknown = { mode: 'custom', path: '/opt/codex' };
    await startOfTurn(codex, 'Be brief.', true, choice);
    await startOfTurn(codex, 'Be brief. Use the house style.', true, choice);

    // The reload restarts within the turn; it must not fall back to the bundled copy.
    expect(processes.map((fake: FakeProcess) => fake.executable)).toEqual([
      '/opt/codex',
      '/opt/codex',
    ]);
  });

  it('theUsersOwnCodexThatCannotStart_saysWhichCodexFailedAndWhatToDo (#1079)', async () => {
    initializeFails = true;
    const codex: CodexClient = client();

    const started: AppServerProcess | string = await codex.ensureServer('run-1', {
      mode: 'custom',
      path: '/opt/old-codex',
    });

    expect(typeof started).toBe('string');
    expect(started).toContain('/opt/old-codex');
    expect(started).toContain('Bundled');
  });

  it('unchangedInstructions_keepTheSameServerAndThread', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'Be brief.');
    // Equal text in a different string object: the comparison is by content.
    const id: string = await startOfTurn(codex, ['Be', 'brief.'].join(' '));

    expect(id).toBe('thread-1');
    expect(processes).toHaveLength(1);
    expect(processes[0].stopped).toBe(false);
    expect(threadRequests().map((request) => request.method)).toEqual(['thread/start']);
    expect(threadRequests()[0].params['developerInstructions']).toBe('Be brief.');
    expect(notes.some((note: string) => note.includes('instructions changed'))).toBe(false);
  });

  it('changedInstructions_restartCodex_andResumeTheSameThreadWithTheNewText', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'Be brief.');
    const id: string = await startOfTurn(codex, 'Be brief. Use the house style.');

    expect(id).toBe('thread-1');
    expect(codex.threadId).toBe('thread-1');
    expect(processes).toHaveLength(2);
    expect(processes[0].stopped).toBe(true);
    expect(processes[1].stopped).toBe(false);
    expect(codex.server).toBe(processes[1]);
    expect(processes[1].requests.map((request) => request.method)).toEqual([
      'initialize',
      'thread/resume',
    ]);
    expect(processes[1].requests[1].params).toMatchObject({
      threadId: 'thread-1',
      developerInstructions: 'Be brief. Use the house style.',
    });
    // Studio already has the id; a reload is not a new session.
    expect(sessions).toEqual(['thread-1']);
    // Stopping the old server on purpose is not reported as Codex stopping.
    expect(lost).toEqual([]);
    expect(notes).toContain(
      "Studio's instructions changed since thread thread-1 was opened; restarting Codex and " +
        'resuming the thread with them.',
    );

    // And once reloaded, the same text again changes nothing.
    await startOfTurn(codex, 'Be brief. Use the house style.');
    expect(processes).toHaveLength(2);
  });

  it('aReload_reusesTheStudioToolServer_andLeavesNoneBehind', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'one');
    await startOfTurn(codex, 'two');
    await startOfTurn(codex, 'three');

    expect(toolServers).toHaveLength(1);
    expect(toolServers[0].closed).toBe(false);
    for (const fake of processes) {
      expect(fake.env[STUDIO_TOKEN_VARIABLE]).toBe('token-1');
    }
    const urls: unknown[] = threadRequests().map(
      (request) =>
        (
          (request.params['config'] as Record<string, unknown>)['mcp_servers'] as Record<
            string,
            Record<string, unknown>
          >
        )['studio']['url'],
    );
    expect(urls).toEqual([
      'http://127.0.0.1:40001/mcp',
      'http://127.0.0.1:40001/mcp',
      'http://127.0.0.1:40001/mcp',
    ]);
    // Only the live server is running; every replaced one was stopped.
    expect(processes.filter((fake: FakeProcess) => !fake.stopped)).toHaveLength(1);

    codex.close();
    expect(toolServers[0].closed).toBe(true);
    expect(processes.every((fake: FakeProcess) => fake.stopped)).toBe(true);
  });

  it('aFailedResume_failsTheTurn_andNeverStartsAFreshThread', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'Be brief.');
    resumeFails = true;

    await expect(startOfTurn(codex, 'Be thorough.')).rejects.toThrow(
      'Codex could not pick the conversation back up with the updated instructions: ' +
        'no rollout found',
    );
    expect(threadRequests().map((request) => request.method)).toEqual([
      'thread/start',
      'thread/resume',
    ]);
    // The conversation is kept, so the next turn tries the same thread again.
    expect(codex.threadId).toBe('thread-1');

    resumeFails = false;
    await expect(startOfTurn(codex, 'Be thorough.')).resolves.toBe('thread-1');
    expect(threadRequests().map((request) => request.method)).toEqual([
      'thread/start',
      'thread/resume',
      'thread/resume',
    ]);
  });

  it('aServerThatStopsOnItsOwn_isStillReportedLost', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'Be brief.');
    processes[0].handlers.onClose(new Error('crashed'));

    expect(lost).toEqual([new Error('crashed')]);
    expect(codex.server).toBeNull();
    expect(codex.threadId).toBeNull();
  });
  it('aThreadWithNoCompletedTurn_isReplacedByAFreshOne_ratherThanResumed', async () => {
    const codex: CodexClient = client();
    // The first turn failed before Codex persisted anything.
    await startOfTurn(codex, 'Be brief.', false);
    const id: string = await startOfTurn(codex, 'Be thorough.');

    expect(id).toBe('thread-2');
    expect(codex.threadId).toBe('thread-2');
    expect(threadRequests().map((request) => request.method)).toEqual([
      'thread/start',
      'thread/start',
    ]);
    expect(threadRequests()[1].params['developerInstructions']).toBe('Be thorough.');
    // Reported the normal way, so Studio resumes the new thread later.
    expect(sessions).toEqual(['thread-1', 'thread-2']);
    // Nothing to resume, so no restart either.
    expect(processes).toHaveLength(1);
    expect(notes).toContain(
      "Studio's instructions changed before thread thread-1 had a completed turn; starting a " +
        'fresh thread with them.',
    );
  });

  it('onceATurnHasCompleted_aChangeResumesOrFails_andNeverStartsAFreshThread', async () => {
    const codex: CodexClient = client();
    await startOfTurn(codex, 'Be brief.', false);
    // The fresh thread completes a turn; from here the conversation is worth keeping.
    await startOfTurn(codex, 'Be thorough.');
    resumeFails = true;

    await expect(startOfTurn(codex, 'Be brief again.')).rejects.toThrow(
      'could not pick the conversation back up',
    );
    expect(threadRequests().map((request) => request.method)).toEqual([
      'thread/start',
      'thread/start',
      'thread/resume',
    ]);
    expect(codex.threadId).toBe('thread-2');
  });

  it('aThreadStudioResumed_countsAsPersisted_fromItsFirstTurn', async () => {
    const codex: CodexClient = client();
    await codex.ensureServer('run-1');
    await codex.ensureThread(turn({ resumeSessionId: 'thread-9' }), policy, 'Be brief.');
    resumeFails = true;

    await expect(
      codex.ensureThread(turn({ resumeSessionId: 'thread-9' }), policy, 'Be thorough.'),
    ).rejects.toThrow('could not pick the conversation back up');
    expect(threadRequests().map((request) => request.method)).toEqual([
      'thread/resume',
      'thread/resume',
    ]);
  });
});
