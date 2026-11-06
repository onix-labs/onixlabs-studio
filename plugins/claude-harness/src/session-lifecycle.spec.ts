import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanUseTool,
  HookCallback,
  Options,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { withSandboxGuidance } from './options';
import type { Answer, HarnessMessage, Request, TurnRequest } from './protocol';
import type { Host, Session } from './session';

/**
 * What the machine reports, none of it the machine's: the login stays the user's, and a turn in these
 * specs is answered by a fake, so nothing here may reach a keychain, a credential file or claude.ai.
 */
const machine: {
  loggedIn: boolean;
  keychainReads: number;
  fileReads: number;
} = vi.hoisted((): { loggedIn: boolean; keychainReads: number; fileReads: number } => ({
  loggedIn: true,
  keychainReads: 0,
  fileReads: 0,
}));

/**
 * What the fake bridge module was asked and how it answers.
 */
const remote: {
  created: unknown;
  attaches: {
    outboundOnly?: boolean;
    onInboundMessage?: (message: unknown) => void;
  }[];
  handles: { closes: number; written: unknown[]; onClose: () => void }[];
  gate: Promise<void>;
} = vi.hoisted(
  (): {
    created: unknown;
    attaches: never[];
    handles: never[];
    gate: Promise<void>;
  } => ({ created: 'remote-1', attaches: [], handles: [], gate: Promise.resolve() }),
);

/**
 * The SDK's stand-in, reaching the fake query once the class below exists.
 */
const sdk: { open: ((prompt: never, options: Options) => unknown) | null } = vi.hoisted(
  (): { open: null } => ({ open: null }),
);

vi.mock('node:child_process', () => {
  const execFileSync: () => string = (): string => {
    machine.keychainReads += 1;
    return JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token' } });
  };
  const spawnSync: () => never = (): never => {
    throw new Error('A spec must not spawn anything.');
  };
  return { execFileSync, spawnSync, default: { execFileSync, spawnSync } };
});

vi.mock('node:fs', () => {
  const existsSync: () => boolean = (): boolean => machine.loggedIn;
  const accessSync: () => never = (): never => {
    throw new Error('ENOENT');
  };
  const readFileSync: () => string = (): string => {
    machine.fileReads += 1;
    return JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token' } });
  };
  const readlinkSync: () => never = (): never => {
    throw new Error('EINVAL');
  };
  const realpathSync: { native: (path: string) => string } = {
    native: (path: string): string => path,
  };
  const constants: { X_OK: number } = { X_OK: 1 };
  return {
    accessSync,
    constants,
    existsSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    default: { accessSync, constants, existsSync, readFileSync, readlinkSync, realpathSync },
  };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: never; options: Options }): unknown =>
    sdk.open?.(prompt, options),
}));

vi.mock('@anthropic-ai/claude-agent-sdk/bridge', () => ({
  createCodeSession: async (): Promise<unknown> => {
    await remote.gate;
    return remote.created;
  },
  fetchRemoteCredentials: (): Promise<unknown> =>
    Promise.resolve({
      worker_jwt: 'fake',
      api_base_url: 'https://example.invalid',
      worker_epoch: 1,
    }),
  isCredentialsFailure: (): boolean => false,
  isCredentialsRejection: (): boolean => false,
  isCreateSessionFailure: (): boolean => false,
  attachBridgeSession: (options: {
    outboundOnly?: boolean;
    onInboundMessage?: (message: unknown) => void;
  }): Promise<unknown> => {
    remote.attaches.push(options);
    const state: { closes: number; written: unknown[]; onClose: () => void } = {
      closes: 0,
      written: [],
      onClose: (): void => undefined,
    };
    remote.handles.push(state);
    return Promise.resolve({
      write: (message: unknown): void => void state.written.push(message),
      sendResult: (): void => undefined,
      reportState: (): void => undefined,
      reportMetadata: (): void => undefined,
      sendControlRequest: (): void => undefined,
      sendControlCancelRequest: (): void => undefined,
      close: (): void => {
        state.closes += 1;
      },
    });
  },
}));

// Imported only now, behind the mocks above, so nothing of it can bind to the real modules.
const sessionModule: typeof import('./session') = await import('./session');

/**
 * A scripted SDK query: frames go in through {@link send}, and the session reads them.
 */
class ScriptedQuery {
  public readonly received: SDKUserMessage[] = [];
  public readonly models: string[] = [];
  public readonly stoppedTasks: string[] = [];
  public interrupts: number = 0;
  public interruptFailure: Error | null = null;
  public stopFailure: Error | null = null;
  public modelFailure: Error | null = null;
  public commandsFailure: Error | null = null;
  public streamFailure: Error | null = null;
  private readonly frames: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private ended: boolean = false;

  public constructor(
    prompt: AsyncIterable<SDKUserMessage>,
    public readonly options: Options,
  ) {
    options.abortController?.signal.addEventListener('abort', (): void => this.end());
    void this.read(prompt);
  }

  public send(frame: Record<string, unknown>): void {
    this.frames.push({ session_id: 'session-1', ...frame } as unknown as SDKMessage);
    this.wake?.();
  }

  public fail(error: Error): void {
    this.streamFailure = error;
    this.wake?.();
  }

  public end(): void {
    this.ended = true;
    this.wake?.();
  }

  public answer(): void {
    const uuid: string | undefined = this.received.at(-1)?.uuid;
    this.send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      ...(uuid === undefined ? {} : { user_message_uuid: uuid }),
    });
  }

  public interrupt(): Promise<void> {
    this.interrupts += 1;
    return this.interruptFailure === null
      ? Promise.resolve()
      : Promise.reject(this.interruptFailure);
  }

  public stopTask(id: string): Promise<void> {
    this.stoppedTasks.push(id);
    return this.stopFailure === null ? Promise.resolve() : Promise.reject(this.stopFailure);
  }

  public setModel(model: string): Promise<void> {
    this.models.push(model);
    return this.modelFailure === null ? Promise.resolve() : Promise.reject(this.modelFailure);
  }

  public supportedCommands(): Promise<readonly unknown[]> {
    return this.commandsFailure === null
      ? Promise.resolve([{ name: 'cost', description: 'Costs', argumentHint: '' }])
      : Promise.reject(this.commandsFailure);
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    while (true) {
      if (this.streamFailure !== null) {
        throw this.streamFailure;
      }
      const next: SDKMessage | undefined = this.frames.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) {
        return;
      }
      await new Promise<void>((resolve: () => void): void => {
        this.wake = resolve;
      });
    }
  }

  private async read(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) {
      this.received.push(message);
    }
  }
}

/**
 * A fake Studio.
 */
interface FakeStudio {
  readonly host: Host;
  readonly sent: HarnessMessage[];
  readonly asked: Request[];
  readonly withdrawn: Request[];
  answers: Partial<Record<Request['kind'], Answer>>;
  fails: Partial<Record<Request['kind'], Error>>;
}

/**
 * A turn under way.
 */
interface StartedTurn {
  readonly done: Promise<void>;
}

let queries: ScriptedQuery[] = [];
let studio: FakeStudio;
let session: Session;

/**
 * Builds a fake Studio.
 * @returns Returns the fake.
 */
function fakeStudio(): FakeStudio {
  const built: FakeStudio = {
    sent: [],
    asked: [],
    withdrawn: [],
    answers: {},
    fails: {},
    host: {
      announcesTurns: true,
      send: (message: HarnessMessage): void => void built.sent.push(message),
      ask: (
        _requestId: string,
        request: Request,
      ): { readonly answer: Promise<Answer>; readonly withdraw: () => void } => {
        built.asked.push(request);
        const failure: Error | undefined = built.fails[request.kind];
        const fallback: Answer =
          request.kind === 'tools'
            ? { kind: 'tools', tools: [], systemPrompt: 'Instructions.' }
            : request.kind === 'credential'
              ? { kind: 'credential', apiKey: 'fake-key' }
              : request.kind === 'tool'
                ? { kind: 'tool', result: 'ran', error: null }
                : request.kind === 'input'
                  ? { kind: 'input', answer: 'Blue' }
                  : { kind: 'permission', granted: true };
        return {
          answer:
            failure === undefined
              ? Promise.resolve(built.answers[request.kind] ?? fallback)
              : Promise.reject(failure),
          withdraw: (): void => void built.withdrawn.push(request),
        };
      },
    },
  };
  return built;
}

/**
 * Builds a turn envelope.
 * @param requestId The run the turn belongs to.
 * @param overrides The fields to set.
 * @returns Returns the turn.
 */
function turn(requestId: string, overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    requestId,
    prompt: `prompt for ${requestId}`,
    workspaceRoot: '/fixture/ws',
    model: 'model-a',
    agentSessionId: 'conversation-1',
    effort: null,
    mode: 'agent',
    surface: 'agent',
    allowedWritePaths: [],
    deniedWritePaths: [],
    allowedNetworkLocations: [],
    deniedNetworkLocations: [],
    tokenCap: 0,
    resumeSessionId: null,
    forkSession: false,
    resumeSessionAt: null,
    // The gate's own subject, not whether this machine has bubblewrap: a CI runner does not.
    requireSandbox: false,
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

/**
 * Lets the pump and the fake query trade what is queued.
 */
async function flush(): Promise<void> {
  for (let index: number = 0; index < 12; index += 1) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Starts a turn and waits until the query has read its prompt.
 * @param request The turn.
 * @returns Returns the turn, held in an object because awaiting would otherwise wait it out too.
 */
async function start(request: TurnRequest): Promise<StartedTurn> {
  const done: Promise<void> = session.run(request);
  await flush();
  return { done };
}

/**
 * Lists the protocol messages of one type.
 * @param type The type.
 * @returns Returns the messages.
 */
function sentOf(type: string): HarnessMessage[] {
  return studio.sent.filter((message: HarnessMessage): boolean => message.type === type);
}

/**
 * Lists the events Studio was sent of one kind.
 * @param kind The kind.
 * @returns Returns the events.
 */
function eventsOf(kind: string): Record<string, unknown>[] {
  return sentOf('event')
    .map((message: HarnessMessage): Record<string, unknown> =>
      message.type === 'event' ? message.event : {},
    )
    .filter((event: Record<string, unknown>): boolean => event['kind'] === kind);
}

describe('Session lifecycle', () => {
  beforeEach(() => {
    queries = [];
    machine.loggedIn = true;
    machine.keychainReads = 0;
    machine.fileReads = 0;
    remote.created = 'remote-1';
    remote.attaches = [];
    remote.handles = [];
    remote.gate = Promise.resolve();
    sdk.open = (prompt: never, options: Options): ScriptedQuery => {
      const query: ScriptedQuery = new ScriptedQuery(prompt, options);
      queries.push(query);
      return query;
    };
    // The bridge module is mocked, so this is only the tripwire for anything that gets past it.
    vi.stubGlobal('fetch', (): never => {
      throw new Error('A spec must not reach the network.');
    });
    studio = fakeStudio();
    session = new sessionModule.Session(studio.host, turn('run-0'));
  });

  afterEach(async () => {
    await session.close();
    vi.unstubAllGlobals();
  });

  describe('promptFor', () => {
    it('placesAttachedPathsAndSelections_aheadOfThePrompt', () => {
      const prompt: string = sessionModule.promptFor(
        turn('r', {
          contextPaths: [
            { kind: 'file', path: '/ws/a.ts' },
            { kind: 'selection', path: '/ws/b.ts', content: 'x' },
            { kind: 'selection', path: '/ws/empty.ts', content: '' },
          ],
        }),
      );

      expect(prompt).toContain(' - /ws/a.ts (file)');
      expect(prompt).toContain('(/ws/b.ts):\n"""\nx\n"""');
      expect(prompt).not.toContain('empty.ts');
      expect(prompt.endsWith('prompt for r')).toBe(true);
    });
  });

  describe('credentials', () => {
    it('neverAsksForAKey_whenThereIsALocalLogin', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].answer();
      await running;

      expect(studio.asked.map((request: Request): string => request.kind)).not.toContain(
        'credential',
      );
    });

    it('asksStudio_whenThereIsNoLocalLogin', async () => {
      machine.loggedIn = false;

      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].answer();
      await running;

      expect(studio.asked.map((request: Request): string => request.kind)).toContain('credential');
    });

    it('anAnswerOfTheWrongKind_opensWithNoKey', async () => {
      machine.loggedIn = false;
      studio.answers.credential = { kind: 'permission', granted: true };

      await start(turn('r1'));

      expect(queries).toHaveLength(1);
    });

    it('aFailedCredentialRoundTrip_failsTheTurn_andOpensNothing', async () => {
      machine.loggedIn = false;
      studio.fails.credential = new Error('Studio went away');

      await session.run(turn('r1'));

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r1', error: 'Studio went away' },
      ]);
      expect(queries).toEqual([]);
    });

    it('closingWhileOpening_startsNoCli', async () => {
      machine.loggedIn = false;
      let release: (answer: Answer) => void = (): void => undefined;
      const ask: Host['ask'] = studio.host.ask.bind(studio.host);
      Object.assign(studio.host, {
        ask: (id: string, request: Request): ReturnType<Host['ask']> =>
          request.kind === 'credential'
            ? {
                answer: new Promise<Answer>((resolve: (answer: Answer) => void): void => {
                  release = resolve;
                }),
                withdraw: (): void => undefined,
              }
            : ask(id, request),
      });

      const running: Promise<void> = session.run(turn('r1'));
      await flush();
      await session.close();
      release({ kind: 'credential', apiKey: 'late' });
      await running;

      expect(queries).toEqual([]);
      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r1', error: 'The Claude session has ended.' },
      ]);
    });
  });

  describe('the tool offer', () => {
    it('anOfferOfTheWrongKind_leavesTheTurnWithNoInstructions', async () => {
      studio.answers.tools = { kind: 'permission', granted: true };

      await start(turn('r1'));

      expect(queries[0].options.systemPrompt).toMatchObject({
        append: withSandboxGuidance('', turn('r1')),
      });
    });

    it('aFailedOffer_failsTheTurn', async () => {
      studio.fails.tools = new Error('Bridge lost');

      await session.run(turn('r1'));

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r1', error: 'Bridge lost' },
      ]);
    });
  });

  describe('images', () => {
    it('sendsImagesAheadOfTheText', async () => {
      await start(turn('r1', { images: [{ mediaType: 'image/png', data: 'AAAA' }] }));

      expect(queries[0].received[0].message.content).toEqual([
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        },
        { type: 'text', text: 'prompt for r1' },
      ]);
    });
  });

  describe('later turns', () => {
    it('appliesAChangedModelLive', async () => {
      const first: Promise<void> = (await start(turn('r1'))).done;
      queries[0].answer();
      await first;

      const second: Promise<void> = (await start(turn('r2', { model: 'model-b' }))).done;
      queries[0].answer();
      await second;

      expect(queries).toHaveLength(1);
      expect(queries[0].models).toEqual(['model-b']);
    });

    it('aRefusedModelChange_doesNotBreakTheTurn', async () => {
      const rejections: unknown[] = [];
      const onRejection: (reason: unknown) => void = (reason: unknown): void => {
        rejections.push(reason);
      };
      process.on('unhandledRejection', onRejection);
      try {
        const first: Promise<void> = (await start(turn('r1'))).done;
        queries[0].answer();
        await first;
        queries[0].modelFailure = new Error('Unknown model');

        const second: Promise<void> = (await start(turn('r2', { model: 'nonsense' }))).done;
        queries[0].answer();
        await second;
        await flush();

        expect(rejections).toEqual([]);
        expect(sentOf('turn.completed')).toHaveLength(2);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });

    it('aTurnAfterTheStreamEnded_failsAtOnce', async () => {
      const first: Promise<void> = (await start(turn('r1'))).done;
      queries[0].end();
      await first;

      await session.run(turn('r2'));

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r2', error: 'The Claude session has ended.' },
      ]);
    });

    it('aSecondTurnWhileOneIsAwaited_settlesBothInOrder', async () => {
      // `main` starts every `turn.start` it reads without waiting, so the session is what keeps the
      // two apart. Overlapping, the second overwrote the first's settle and the first never ended.
      const first: Promise<void> = (await start(turn('r1'))).done;
      const second: Promise<void> = (await start(turn('r2'))).done;

      expect(queries[0].received).toHaveLength(1);

      queries[0].answer();
      await first;
      await flush();

      expect(queries[0].received).toHaveLength(2);

      queries[0].answer();
      await second;

      expect(
        sentOf('turn.completed').map((message: HarnessMessage): unknown =>
          message.type === 'turn.completed' ? message.requestId : null,
        ),
      ).toEqual(['r1', 'r2']);
    });

    it('aWaitingTurn_failsWhenTheStreamEndsUnderTheOneAhead', async () => {
      const first: Promise<void> = (await start(turn('r1'))).done;
      const second: Promise<void> = (await start(turn('r2'))).done;

      queries[0].end();
      await Promise.all([first, second]);

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r2', error: 'The Claude session has ended.' },
      ]);
    });

    it('aWaitingTurn_leavesTheRunningQueryAloneUntilItsGo', async () => {
      const first: Promise<void> = (await start(turn('r1'))).done;
      const second: Promise<void> = (await start(turn('r2', { model: 'model-b' }))).done;

      // The waiting turn has not touched the query the first is running on.
      expect(queries[0].models).toEqual([]);

      queries[0].answer();
      await first;
      await flush();
      queries[0].answer();
      await second;

      expect(queries[0].models).toEqual(['model-b']);
    });
  });

  describe('steering and stopping', () => {
    it('steer_queuesAFollowUpOnTheRunningQuery', async () => {
      await start(turn('r1'));

      session.steer('and also this');
      await flush();

      expect(queries[0].received.at(-1)?.message.content).toBe('and also this');
    });

    it('steer_onAnEndedSession_isDropped', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].end();
      await running;

      session.steer('too late');
      await flush();

      expect(queries[0].received).toHaveLength(1);
    });

    it('interrupt_beforeAnyQuery_doesNothing', () => {
      expect(() => session.interrupt()).not.toThrow();
      expect(() => session.stopTask('t')).not.toThrow();
    });

    it('interrupt_settlesTheTurn_evenWhenTheCliProducesNoResult', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;

      session.interrupt();
      await running;

      expect(queries[0].interrupts).toBe(1);
      expect(sentOf('turn.completed')).toHaveLength(1);
    });

    it('aFailedInterrupt_stillSettlesTheTurn', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].interruptFailure = new Error('Already gone');

      session.interrupt();
      await running;

      expect(sentOf('turn.completed')).toHaveLength(1);
    });

    it('aFailedTaskStop_isOnlyNoted', async () => {
      await start(turn('r1'));
      queries[0].stopFailure = new Error('Unknown task');

      session.stopTask('t1');
      await flush();

      expect(queries[0].stoppedTasks).toEqual(['t1']);
    });

    it('panic_stopsEveryLiveTaskAndTheTurn', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      for (const id of ['t1', 't2']) {
        queries[0].send({
          type: 'system',
          subtype: 'task_started',
          task_id: id,
          description: id,
        });
      }
      await flush();

      session.panic();
      await running;

      expect(queries[0].stoppedTasks).toEqual(['t1', 't2']);
      expect(queries[0].interrupts).toBe(1);
    });
  });

  describe('background tasks', () => {
    it('panicLeavesOutATaskThatFinishedInTheForeground', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].send({ type: 'system', subtype: 'task_started', task_id: 't1', description: 'a' });
      queries[0].send({
        type: 'system',
        subtype: 'task_updated',
        task_id: 't1',
        patch: { status: 'completed' },
      });
      await flush();

      session.panic();
      await running;

      expect(queries[0].stoppedTasks).toEqual([]);
    });

    it('aTaskStillRunningAfterAnUpdate_staysLive', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].send({ type: 'system', subtype: 'task_started', task_id: 't1', description: 'a' });
      queries[0].send({
        type: 'system',
        subtype: 'task_progress',
        task_id: 't1',
        description: 'b',
        usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
      });
      queries[0].send({
        type: 'system',
        subtype: 'task_progress',
        task_id: 'never-started',
        description: 'c',
        usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
      });
      queries[0].send({
        type: 'system',
        subtype: 'task_updated',
        task_id: 't1',
        patch: { status: 'running' },
      });
      await flush();

      session.panic();
      await running;

      expect(queries[0].stoppedTasks).toEqual(['t1']);
      expect(sentOf('turn.failed')).toEqual([]);
    });
  });

  describe('frames the session must see past', () => {
    it('publishesACommandListThatChangesMidSession', async () => {
      await start(turn('r1'));
      const before: number = eventsOf('commands').length;

      queries[0].send({
        type: 'system',
        subtype: 'commands_changed',
        commands: [{ name: 'new', description: 'New', argumentHint: '' }],
      });
      await flush();

      expect(eventsOf('commands').length).toBe(before + 1);
    });

    it('aFailedCommandDiscovery_leavesTheTurnRunning', async () => {
      const original: typeof sdk.open = sdk.open;
      sdk.open = (prompt: never, options: Options): unknown => {
        const query: ScriptedQuery = original?.(prompt, options) as ScriptedQuery;
        query.commandsFailure = new Error('Not initialised');
        return query;
      };

      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].answer();
      await running;

      expect(sentOf('turn.completed')).toHaveLength(1);
    });

    it('aResultStampedForAnotherPrompt_doesNotAnswerTheTurn', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      let settled: boolean = false;
      void running.then((): void => {
        settled = true;
      });

      queries[0].send({ type: 'result', subtype: 'success', user_message_uuids: ['someone-else'] });
      await flush();
      expect(settled).toBe(false);

      queries[0].answer();
      await running;
      expect(settled).toBe(true);
    });

    it('anUnstampedResult_answersTheTurnOnceThePromptIsAcknowledged', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].send({
        type: 'assistant',
        user_message_uuid: queries[0].received[0].uuid,
        message: { role: 'assistant', content: [] },
      });
      await flush();

      queries[0].send({ type: 'result', subtype: 'success' });
      await running;

      expect(sentOf('turn.completed')).toHaveLength(1);
    });

    it('anUnstampedErrorResult_answersTheTurn_soItCannotHang', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;

      queries[0].send({ type: 'result', subtype: 'error_during_execution', is_error: true });
      await running;

      expect(sentOf('turn.completed')).toHaveLength(1);
    });

    it('stampsAmongNonStrings_areIgnored', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      let settled: boolean = false;
      void running.then((): void => {
        settled = true;
      });

      queries[0].send({ type: 'result', subtype: 'success', user_message_uuids: [7, null] });
      await flush();

      expect(settled).toBe(false);
      queries[0].answer();
      await running;
    });

    it('aReplayedResultWithNothingAwaited_reportsCompleted', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;
      queries[0].answer();
      await running;

      queries[0].send({ type: 'result', subtype: 'success' });
      await flush();

      expect(eventsOf('status').length).toBeGreaterThan(0);
    });
  });

  describe('a stream that fails', () => {
    it('failsTheAwaitedTurn_andRefusesTheNext', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;

      queries[0].fail(new Error('CLI crashed'));
      await running;
      await session.run(turn('r2'));

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r1', error: 'CLI crashed' },
        { type: 'turn.failed', requestId: 'r2', error: 'The Claude session has ended.' },
      ]);
    });

    it('aNonErrorThrown_isStillReported', async () => {
      const running: Promise<void> = (await start(turn('r1'))).done;

      queries[0].fail('plain text' as unknown as Error);
      await running;

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r1', error: 'plain text' },
      ]);
    });

    it('underAnAdoptedTurn_tellsTheRendererItStopped', async () => {
      const first: Promise<void> = (await start(turn('r1', { remoteControl: 'control' }))).done;
      await flush();
      queries[0].answer();
      await first;
      remote.attaches[0].onInboundMessage?.({ message: { content: 'from the phone' } });
      await flush();

      queries[0].fail(new Error('CLI crashed'));
      await flush();

      expect(eventsOf('status').at(-1)).toMatchObject({ state: 'aborted' });
    });

    it('aTeardownThatSurfacesAsAStreamError_settlesRatherThanFails', async () => {
      const original: typeof sdk.open = sdk.open;
      sdk.open = (prompt: never, options: Options): unknown => {
        const query: ScriptedQuery = original?.(prompt, options) as ScriptedQuery;
        options.abortController?.signal.addEventListener('abort', (): void => {
          query.fail(new Error('Aborted'));
        });
        return query;
      };
      const running: Promise<void> = (await start(turn('r1'))).done;

      await session.close();
      await running;

      expect(sentOf('turn.failed')).toEqual([]);
      expect(sentOf('turn.completed')).toHaveLength(1);
    });
  });

  describe('a reopen that fails', () => {
    it('endsTheSession_ratherThanStartingWithoutItsHistory', async () => {
      const first: Promise<void> = (await start(turn('r1'))).done;
      queries[0].send({ type: 'system', subtype: 'init' });
      queries[0].answer();
      await first;
      studio.answers.tools = { kind: 'tools', tools: [], systemPrompt: 'New instructions.' };
      sdk.open = (): never => {
        throw new Error('CLI missing');
      };

      await session.run(turn('r2'));
      await session.run(turn('r3'));

      expect(sentOf('turn.failed')).toEqual([
        { type: 'turn.failed', requestId: 'r2', error: 'CLI missing' },
        { type: 'turn.failed', requestId: 'r3', error: 'The Claude session has ended.' },
      ]);
    });

    it('aStreamErrorFromTheRetiredQuery_isNotTheSessionsToActOn', async () => {
      const original: typeof sdk.open = sdk.open;
      sdk.open = (prompt: never, options: Options): unknown => {
        const query: ScriptedQuery = original?.(prompt, options) as ScriptedQuery;
        if (queries.length === 1) {
          options.abortController?.signal.addEventListener('abort', (): void => {
            query.fail(new Error('Aborted'));
          });
        }
        return query;
      };
      const first: Promise<void> = (await start(turn('r1'))).done;
      queries[0].send({ type: 'system', subtype: 'init' });
      queries[0].answer();
      await first;
      studio.answers.tools = { kind: 'tools', tools: [], systemPrompt: 'New instructions.' };

      const second: Promise<void> = (await start(turn('r2'))).done;
      queries[1].send({ type: 'system', subtype: 'init' });
      queries[1].answer();
      await second;

      expect(queries).toHaveLength(2);
      expect(sentOf('turn.failed')).toEqual([]);
      expect(sentOf('turn.completed')).toHaveLength(2);
    });
  });

  describe('the gate', () => {
    it('putsAToolToStudio_andRunsItOnYes', async () => {
      await start(turn('r1'));
      const gate: CanUseTool | undefined = queries[0].options.canUseTool;

      const decision: unknown = await gate?.(
        'Bash',
        { command: 'npm test' },
        { signal: new AbortController().signal, toolUseID: 'tool-1', requestId: 'r1' },
      );

      expect(decision).toMatchObject({ behavior: 'allow' });
      expect(studio.asked.at(-1)).toMatchObject({ kind: 'permission' });
    });

    it('anAnswerOfTheWrongKind_isARefusal', async () => {
      studio.answers.permission = { kind: 'input', answer: 'yes' };
      await start(turn('r1'));

      const decision: unknown = await queries[0].options.canUseTool?.(
        'Bash',
        { command: 'npm test' },
        { signal: new AbortController().signal, toolUseID: 'tool-1', requestId: 'r1' },
      );

      expect(decision).toMatchObject({ behavior: 'deny' });
    });

    it('asksTheUsersQuestions_throughStudio', async () => {
      await start(turn('r1'));

      const decision: unknown = await queries[0].options.canUseTool?.(
        'AskUserQuestion',
        { questions: [{ question: 'Which?', options: [{ label: 'Blue' }] }] },
        { signal: new AbortController().signal, toolUseID: 'tool-1', requestId: 'r1' },
      );

      expect(studio.asked.at(-1)).toMatchObject({ kind: 'input', question: 'Which?' });
      expect(decision).toMatchObject({ behavior: 'allow' });
    });

    it('aQuestionAnsweredOfTheWrongKind_isDeclined', async () => {
      studio.answers.input = { kind: 'permission', granted: true };
      await start(turn('r1'));

      const decision: unknown = await queries[0].options.canUseTool?.(
        'AskUserQuestion',
        { questions: [{ question: 'Which?', options: [{ label: 'Blue' }] }] },
        { signal: new AbortController().signal, toolUseID: 'tool-1', requestId: 'r1' },
      );

      expect(decision).toMatchObject({ behavior: 'deny' });
    });

    it('auditsWhatActuallyRan', async () => {
      await start(turn('r1'));
      const hook: HookCallback | undefined = queries[0].options.hooks?.PostToolUse?.[0].hooks[0];

      await hook?.({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never, 'tool-1', {
        signal: new AbortController().signal,
      });

      expect(sentOf('audit')).toMatchObject([{ type: 'audit', requestId: 'r1', name: 'Bash' }]);
    });
  });

  describe('studio tools through the mcp server', () => {
    /**
     * Reaches the server the session exposes to the CLI.
     * @returns Returns its request handlers.
     */
    function handlers(): Map<string, (request: unknown, extra: unknown) => Promise<unknown>> {
      const config: unknown = queries[0].options.mcpServers?.['studio'];
      const instance: {
        server: {
          _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
        };
      } = (config as { instance: never }).instance;
      return instance.server._requestHandlers;
    }

    it('anOfferOfTheWrongKind_listsNoTools', async () => {
      await start(turn('r1'));
      studio.answers.tools = { kind: 'permission', granted: true };

      const listed: unknown = await handlers().get('tools/list')?.({ method: 'tools/list' }, {});

      expect(listed).toEqual({ tools: [] });
    });

    it('anAnswerOfTheWrongKind_refusesTheTool', async () => {
      await start(turn('r1'));
      studio.answers.tool = { kind: 'permission', granted: true };

      const called: unknown = await handlers().get('tools/call')?.(
        { method: 'tools/call', params: { name: 'read_document', arguments: {} } },
        {},
      );

      expect(JSON.stringify(called)).toContain('Studio refused to run the tool.');
    });
  });

  describe('remote control', () => {
    it('neverOpens_whenLeftOff', async () => {
      await start(turn('r1'));

      expect(machine.keychainReads + machine.fileReads).toBe(0);
      expect(remote.attaches).toEqual([]);
    });

    it('mirror_opensViewOnly_withTheCurrentTurnsWorkspace', async () => {
      await start(turn('r1', { remoteControl: 'mirror' }));
      await flush();

      expect(remote.attaches).toHaveLength(1);
      expect(remote.attaches[0].outboundOnly).toBe(true);
      expect(remote.attaches[0].onInboundMessage).toBeUndefined();
    });

    it('anUnknownMode_aimsOff', async () => {
      await start(turn('r1', { remoteControl: 'mirror' }));
      await flush();

      session.setRemoteControl('nonsense' as 'off');

      expect(remote.handles[0].closes).toBe(1);
    });

    it('repeatingTheAim_opensNothingMore', async () => {
      await start(turn('r1', { remoteControl: 'control' }));
      await flush();

      session.setRemoteControl('control');
      await flush();

      expect(remote.attaches).toHaveLength(1);
    });

    it('forwardsWholeMessages_butNotPartials', async () => {
      await start(turn('r1', { remoteControl: 'mirror' }));
      await flush();

      queries[0].send({ type: 'stream_event', event: { type: 'message_start' } });
      queries[0].send({ type: 'assistant', message: { role: 'assistant', content: [] } });
      await flush();

      expect(remote.handles[0].written).toHaveLength(1);
    });

    it('aPeersMessage_isEchoedAndRunsAsAnAdoptedTurn', async () => {
      const running: Promise<void> = (await start(turn('r1', { remoteControl: 'control' }))).done;
      await flush();
      queries[0].answer();
      await running;

      remote.attaches[0].onInboundMessage?.({ message: { content: 'from the phone' } });
      await flush();
      queries[0].send({ type: 'system', subtype: 'init' });
      await flush();

      expect(queries[0].received.at(-1)?.message.content).toBe('from the phone');
      expect(eventsOf('turn-started').at(-1)).toMatchObject({ reason: 'remote' });

      queries[0].answer();
      await flush();
      expect(eventsOf('status').at(-1)).toMatchObject({ state: 'completed' });
    });

    it('aPeersMessageAfterTheSessionEnded_isDropped', async () => {
      const running: Promise<void> = (await start(turn('r1', { remoteControl: 'control' }))).done;
      await flush();
      const inbound: ((message: unknown) => void) | undefined = remote.attaches[0].onInboundMessage;
      queries[0].end();
      await running;

      inbound?.({ message: { content: 'too late' } });
      await flush();

      expect(queries[0].received).toHaveLength(1);
    });

    it('aBridgeThatFinishesOpeningAfterTheAimMoved_isDiscarded', async () => {
      let release: () => void = (): void => undefined;
      remote.gate = new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
      await start(turn('r1', { remoteControl: 'control' }));

      session.setRemoteControl('off');
      release();
      await flush();

      expect(remote.handles).toHaveLength(1);
      expect(remote.handles[0].closes).toBe(1);
    });

    it('aBridgeThatFinishesOpeningAfterTheSessionClosed_isDiscarded', async () => {
      let release: () => void = (): void => undefined;
      remote.gate = new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
      await start(turn('r1', { remoteControl: 'control' }));

      await session.close();
      release();
      await flush();

      expect(remote.handles[0].closes).toBe(1);
    });

    it('aRetargetBeforeTheFirstBridgeOpens_keepsOnlyTheLastOne', async () => {
      let release: () => void = (): void => undefined;
      remote.gate = new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
      await start(turn('r1', { remoteControl: 'control' }));

      session.setRemoteControl('off');
      session.setRemoteControl('control');
      release();
      await flush();

      expect(remote.handles).toHaveLength(2);
      expect(remote.handles.map((handle: { closes: number }): number => handle.closes)).toEqual([
        1, 0,
      ]);
    });

    it('aFailedOpen_leavesTheTurnUntouched', async () => {
      remote.created = null;

      const running: Promise<void> = (await start(turn('r1', { remoteControl: 'control' }))).done;
      await flush();
      queries[0].answer();
      await running;

      expect(remote.attaches).toEqual([]);
      expect(sentOf('turn.completed')).toHaveLength(1);
    });

    it('closingTheSession_closesTheBridge', async () => {
      await start(turn('r1', { remoteControl: 'mirror' }));
      await flush();

      await session.close();
      await session.close();

      expect(remote.handles[0].closes).toBe(1);
    });

    it('aModeChangeOnAClosedSession_opensNothing', async () => {
      await session.close();

      session.setRemoteControl('control');
      await flush();

      expect(remote.attaches).toEqual([]);
      expect(machine.keychainReads + machine.fileReads).toBe(0);
    });
  });
});
