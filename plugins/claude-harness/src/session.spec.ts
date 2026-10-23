import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Answer, HarnessMessage, Request, TurnRequest } from './protocol';
import { Session, type Host } from './session';

/**
 * A stand-in for the SDK query: it reads the prompt stream the session feeds it and answers each
 * message with a result, stamped the way the CLI stamps the turn it answers.
 */
class FakeQuery {
  /**
   * Holds the user messages the query has read from its prompt stream.
   */
  public readonly received: SDKUserMessage[] = [];

  /**
   * Holds whether the query's input has ended or its process been aborted.
   */
  public ended: boolean = false;

  /**
   * Holds the frames waiting to be read by the session's pump.
   */
  private readonly frames: SDKMessage[] = [];

  /**
   * Wakes the pump's read when a frame is queued or the query ends.
   */
  private wake: (() => void) | null = null;

  /**
   * Holds whether the session id has been reported yet.
   */
  private initialised: boolean = false;

  /**
   * Initialises a new instance of the {@link FakeQuery} class.
   * @param prompt The prompt stream the session feeds.
   * @param options The options the session opened the query with.
   * @param sessionId The session id the query reports.
   * @param autoComplete Whether each message is answered as soon as it is read.
   */
  public constructor(
    prompt: AsyncIterable<SDKUserMessage>,
    public readonly options: Options,
    private readonly sessionId: string,
    private readonly autoComplete: boolean,
  ) {
    options.abortController?.signal.addEventListener('abort', (): void => this.end());
    void this.read(prompt);
  }

  /**
   * Answers the latest message read with a successful result.
   */
  public complete(): void {
    const message: SDKUserMessage | undefined = this.received.at(-1);
    this.push({
      type: 'result',
      subtype: 'success',
      session_id: this.sessionId,
      is_error: false,
      ...(message?.uuid === undefined ? {} : { user_message_uuid: message.uuid }),
    } as unknown as SDKMessage);
  }

  /**
   * Reports a background task starting, which keeps the session busy until it settles.
   * @param taskId The task.
   */
  public startTask(taskId: string): void {
    this.push({
      type: 'system',
      subtype: 'task_started',
      session_id: this.sessionId,
      task_id: taskId,
      description: 'A long build',
    } as unknown as SDKMessage);
  }

  /**
   * Queues any frame, for a test that plays the CLI's side of a turn by hand.
   * @param frame The frame.
   */
  public send(frame: Record<string, unknown>): void {
    this.push({ session_id: this.sessionId, ...frame } as unknown as SDKMessage);
  }

  /**
   * Gets the slash commands, of which there are none.
   * @returns Returns no commands.
   */
  public supportedCommands(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }

  /**
   * Accepts a live model change.
   * @returns Returns once applied.
   */
  public setModel(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Yields the queued frames until the query ends.
   * @returns Yields the SDK messages.
   */
  public async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    while (true) {
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

  /**
   * Reads the prompt stream, reporting the session id with the first message.
   * @param prompt The prompt stream.
   */
  private async read(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) {
      if (this.ended) {
        return;
      }
      this.received.push(message);
      if (!this.initialised) {
        this.initialised = true;
        this.push({
          type: 'system',
          subtype: 'init',
          session_id: this.sessionId,
        } as unknown as SDKMessage);
      }
      if (this.autoComplete) {
        this.complete();
      }
    }
    this.end();
  }

  /**
   * Queues a frame for the pump.
   * @param frame The frame.
   */
  private push(frame: SDKMessage): void {
    this.frames.push(frame);
    this.wake?.();
  }

  /**
   * Ends the query.
   */
  private end(): void {
    this.ended = true;
    this.wake?.();
  }
}

/**
 * The state the mocked SDK and the fake Studio share with each test.
 *
 * ⚠️ Hoisted with the mock, so it cannot name {@link FakeQuery}: the mock reaches the fake through
 * `open`, which is assigned once the class exists.
 */
const sdk: {
  queries: FakeQuery[];
  autoComplete: boolean;
  resumeAs: string | null;
  sequence: number;
  open: ((prompt: AsyncIterable<SDKUserMessage>, options: Options) => unknown) | null;
} = vi.hoisted(
  (): {
    queries: never[];
    autoComplete: boolean;
    resumeAs: string | null;
    sequence: number;
    open: null;
  } => ({ queries: [], autoComplete: true, resumeAs: null, sequence: 0, open: null }),
);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Options;
  }): unknown => sdk.open?.(prompt, options),
}));

sdk.open = (prompt: AsyncIterable<SDKUserMessage>, options: Options): FakeQuery => {
  sdk.sequence += 1;
  // A resume reports the id it resumed, unless the test has it come back as another conversation.
  const sessionId: string =
    options.resume === undefined ? `fresh-${sdk.sequence}` : (sdk.resumeAs ?? options.resume);
  const query: FakeQuery = new FakeQuery(prompt, options, sessionId, sdk.autoComplete);
  sdk.queries.push(query);
  return query;
};

/**
 * A fake Studio: it records what the session sends and answers the `tools` question with whatever
 * instructions the test has set.
 */
interface FakeStudio {
  readonly host: Host;
  readonly sent: HarnessMessage[];
  readonly asked: Request[];
  instructions: string;
  announcesTurns: boolean;
}

/**
 * Builds a fake Studio.
 * @returns Returns the fake.
 */
function fakeStudio(): FakeStudio {
  const studio: FakeStudio = {
    sent: [],
    asked: [],
    instructions: 'Profile: be terse.',
    announcesTurns: true,
    host: {
      get announcesTurns(): boolean {
        return studio.announcesTurns;
      },
      send: (message: HarnessMessage): void => {
        studio.sent.push(message);
      },
      ask: (
        _requestId: string,
        request: Request,
      ): { readonly answer: Promise<Answer>; readonly withdraw: () => void } => {
        studio.asked.push(request);
        let answer: Answer;
        if (request.kind === 'tools') {
          answer = { kind: 'tools', tools: [], systemPrompt: studio.instructions };
        } else if (request.kind === 'credential') {
          answer = { kind: 'credential', apiKey: null };
        } else {
          answer = { kind: 'permission', granted: false };
        }
        return { answer: Promise.resolve(answer), withdraw: (): void => undefined };
      },
    },
  };
  return studio;
}

/**
 * Builds a turn envelope.
 * @param requestId The run the turn belongs to.
 * @returns Returns the turn.
 */
function turn(requestId: string): TurnRequest {
  return {
    requestId,
    prompt: `prompt for ${requestId}`,
    workspaceRoot: null,
    model: 'claude-sonnet-4-5',
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
    permissionPosture: 'prompt',
    toolPolicies: {},
    images: [],
    contextPaths: [],
    remoteControl: 'off',
    agentShell: null,
    owningTabId: null,
    providerSettings: {},
  };
}

/**
 * Lets the pump and the fake query trade the frames already queued.
 */
async function flush(): Promise<void> {
  for (let index: number = 0; index < 10; index += 1) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Reads the instructions a query was opened with.
 * @param query The query.
 * @returns Returns the text appended to its system prompt.
 */
function instructionsOf(query: FakeQuery): unknown {
  return (query.options.systemPrompt as { append?: unknown }).append;
}

describe('Session instructions (#955)', () => {
  beforeEach((): void => {
    sdk.queries = [];
    sdk.autoComplete = true;
    sdk.resumeAs = null;
    sdk.sequence = 0;
  });

  it('keepsTheQueryOpen_whenTheInstructionsAreUnchanged', async () => {
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));

    await session.run(turn('r1'));
    await session.run(turn('r2'));

    expect(sdk.queries.length).toBe(1);
    expect(sdk.queries[0].received.length).toBe(2);
    await session.close();
  });

  it('reopensResumingTheSameSession_withTheNewSystemPrompt_whenTheInstructionsChange', async () => {
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    await session.run(turn('r1'));
    const first: FakeQuery = sdk.queries[0];

    studio.instructions = 'Profile: be terse.\n\nSkills: release-notes';
    await session.run(turn('r2'));

    expect(sdk.queries.length).toBe(2);
    expect(first.ended).toBe(true);
    const second: FakeQuery = sdk.queries[1];
    expect(second.options.resume).toBe('fresh-1');
    expect(second.options.forkSession).toBeUndefined();
    expect(second.options.resumeSessionAt).toBeUndefined();
    expect(instructionsOf(second)).toBe('Profile: be terse.\n\nSkills: release-notes');
    // Without this the CLI resends the prompt it recorded at the first request, and the resume
    // silently keeps the old instructions — which is how the first live test of #955 failed.
    expect((second.options.systemPrompt as { snapshot?: unknown }).snapshot).toBe(false);
    // The turn that saw the change is the first the new instructions apply to.
    expect(second.received.length).toBe(1);
    expect(first.received.length).toBe(1);
    expect(session.sessionId).toBe('fresh-1');
    expect(studio.sent).toContainEqual({
      type: 'turn.completed',
      requestId: 'r2',
      sessionId: 'fresh-1',
    });
    await session.close();
  });

  it('reopensOnlyAtTheNextTurnStart_neverMidTurn', async () => {
    sdk.autoComplete = false;
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    const running: Promise<void> = session.run(turn('r1'));
    await flush();

    studio.instructions = 'Profile: be thorough.';
    await flush();

    // Changed while the turn runs: nothing is reopened until the turn has settled.
    expect(sdk.queries.length).toBe(1);
    sdk.queries[0].complete();
    await running;
    expect(sdk.queries.length).toBe(1);

    sdk.autoComplete = true;
    const next: Promise<void> = session.run(turn('r2'));
    await flush();
    expect(sdk.queries.length).toBe(2);
    expect(instructionsOf(sdk.queries[1])).toBe('Profile: be thorough.');
    await next;
    await session.close();
  });

  it('waitsForABackgroundTask_beforeReopening', async () => {
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    await session.run(turn('r1'));
    sdk.queries[0].startTask('task-1');
    await flush();

    studio.instructions = 'Profile: be thorough.';
    await session.run(turn('r2'));

    // Reopening would kill the task with the query's process, so the old instructions stand.
    expect(sdk.queries.length).toBe(1);
    expect(sdk.queries[0].received.length).toBe(2);
    await session.close();
  });

  it('endsTheConversation_ratherThanAdoptingAFreshSession_whenTheResumeComesBackAsAnother', async () => {
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    await session.run(turn('r1'));

    sdk.resumeAs = 'someone-else';
    studio.instructions = 'Profile: be thorough.';
    await session.run(turn('r2'));

    expect(studio.sent).toContainEqual({
      type: 'turn.failed',
      requestId: 'r2',
      error: 'The Claude session could not be resumed, so the conversation has ended.',
    });
    expect(session.sessionId).toBe('fresh-1');
    expect(
      studio.sent.some(
        (message: HarnessMessage): boolean =>
          message.type === 'event' && message.event['sessionId'] === 'someone-else',
      ),
    ).toBe(false);

    // And it stays ended: a later turn is refused rather than opened fresh.
    await session.run(turn('r3'));
    expect(sdk.queries.length).toBe(2);
    expect(studio.sent).toContainEqual({
      type: 'turn.failed',
      requestId: 'r3',
      error: 'The Claude session has ended.',
    });
    await session.close();
  });
});

describe('Session turn start (#1070)', () => {
  beforeEach((): void => {
    sdk.queries = [];
    sdk.autoComplete = true;
    sdk.resumeAs = null;
    sdk.sequence = 0;
  });

  /**
   * Reads the turn-started events a fake Studio was sent.
   * @param studio The fake.
   * @returns Returns the events.
   */
  function turnsStarted(studio: FakeStudio): readonly Record<string, unknown>[] {
    return studio.sent
      .filter((message: HarnessMessage): boolean => message.type === 'event')
      .map((message: HarnessMessage): Record<string, unknown> =>
        message.type === 'event' ? message.event : {},
      )
      .filter((event: Record<string, unknown>): boolean => event['kind'] === 'turn-started');
  }

  it('announcesTheReportBackTurnOnce_asTheCliResumes', async () => {
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    await session.run(turn('r1'));
    const query: FakeQuery = sdk.queries[0];
    query.startTask('task-1');
    await flush();

    query.send({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'completed',
      summary: 'Built',
      output_file: '/tmp/out',
    });
    query.send({ type: 'system', subtype: 'init' });
    query.send({
      type: 'assistant',
      uuid: 'u-1',
      parent_tool_use_id: null,
      message: { id: 'm-1', content: [{ type: 'text', text: 'The build passed.' }] },
    });
    await flush();

    expect(turnsStarted(studio)).toEqual([
      {
        requestId: 'r1',
        kind: 'turn-started',
        agentSessionId: 'conversation-1',
        reason: 'report-back',
      },
    ]);
    await session.close();
  });

  it('saysNothingToAStudioThatPredatesTheEvent', async () => {
    // An older Studio has never heard of the kind; the timer it already has stands.
    const studio: FakeStudio = fakeStudio();
    studio.announcesTurns = false;
    const session: Session = new Session(studio.host, turn('r1'));
    await session.run(turn('r1'));
    const query: FakeQuery = sdk.queries[0];
    query.startTask('task-1');
    await flush();

    query.send({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'completed',
    });
    query.send({ type: 'system', subtype: 'init' });
    await flush();

    expect(turnsStarted(studio)).toEqual([]);
    await session.close();
  });

  it('announcesNothingForAReplayedNotification', async () => {
    // A task this session never saw start is history from a previous process (#709), not a turn.
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    await session.run(turn('r1'));
    const query: FakeQuery = sdk.queries[0];

    query.send({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'gone',
      status: 'stopped',
    });
    query.send({ type: 'system', subtype: 'init' });
    await flush();

    expect(turnsStarted(studio)).toEqual([]);
    await session.close();
  });

  it('streamsAReplyAndShowsItOnce', async () => {
    sdk.autoComplete = false;
    const studio: FakeStudio = fakeStudio();
    const session: Session = new Session(studio.host, turn('r1'));
    const running: Promise<void> = session.run(turn('r1'));
    await flush();
    const query: FakeQuery = sdk.queries[0];

    query.send({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'm-1' } },
    });
    query.send({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello, ' },
      },
    });
    query.send({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world.' },
      },
    });
    query.send({
      type: 'assistant',
      uuid: 'u-1',
      parent_tool_use_id: null,
      message: { id: 'm-1', content: [{ type: 'text', text: 'Hello, world.' }] },
    });
    query.complete();
    await running;

    const text: string[] = studio.sent
      .filter((message: HarnessMessage): boolean => message.type === 'event')
      .map((message: HarnessMessage): Record<string, unknown> =>
        message.type === 'event' ? message.event : {},
      )
      .filter((event: Record<string, unknown>): boolean => event['kind'] === 'text')
      .map(
        (event: Record<string, unknown>): string =>
          `${String(event['delta'])}|${String(event['messageUuid'])}`,
      );
    // The whole message adds no text, only its uuid: the transcript's anchor for a rewind.
    expect(text).toEqual(['Hello, |undefined', 'world.|undefined', '|u-1']);
    expect(query.options.includePartialMessages).toBe(true);
    await session.close();
  });
});
