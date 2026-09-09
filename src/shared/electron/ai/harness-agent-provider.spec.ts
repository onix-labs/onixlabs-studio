import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROTOCOL_VERSION } from '@shared/api/agent-protocol';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { HarnessAgentProvider, toTurnRequest } = await import('./harness-agent-provider');
type ProviderType = InstanceType<typeof HarnessAgentProvider>;

/**
 * A transport that answers the handshake automatically and settles whatever turn it is given, so a
 * spec can exercise the provider without a process or a real harness.
 */
class ScriptedHarness {
  /**
   * Holds the messages the provider sent, parsed.
   */
  public readonly sent: Record<string, unknown>[] = [];

  /**
   * Holds the requests to push at the provider once a turn starts.
   */
  public requests: unknown[] = [];

  /**
   * Holds the events to stream at the provider once a turn starts.
   */
  public events: unknown[] = [];

  /**
   * Holds whether the harness declares it accepts steering.
   */
  public steering: boolean = true;

  /**
   * Holds the protocol version the harness declares.
   */
  public version: string = AGENT_PROTOCOL_VERSION;

  /**
   * Holds the line handler.
   */
  private lines: ((line: string) => void) | null = null;

  /**
   * Answers what the provider sends, driving the exchange forward.
   * @param line The serialised message.
   */
  public send(line: string): void {
    const message: Record<string, unknown> = JSON.parse(line) as Record<string, unknown>;
    this.sent.push(message);
    if (message['type'] === 'initialize') {
      this.emit({
        type: 'ready',
        capabilities: {
          protocolVersion: this.version,
          sessionModel: 'live-harness',
          steering: this.steering,
          images: true,
          efforts: ['low', 'high'],
          resumable: true,
        },
      });
      return;
    }
    if (message['type'] === 'turn.start') {
      const asked: unknown = (message['turn'] as Record<string, unknown>)['requestId'];
      const requestId: string = typeof asked === 'string' ? asked : '';
      for (const event of this.events) {
        this.emit({ type: 'event', event });
      }
      for (const [index, request] of this.requests.entries()) {
        this.emit({ type: 'request', callId: `c${index}`, requestId, request });
      }
      // Settled after the requests, on a later tick, so the answers are exchanged first.
      queueMicrotask((): void => this.emit({ type: 'turn.completed', requestId, sessionId: 's1' }));
    }
  }

  /**
   * Registers the line handler.
   * @param handler The handler.
   */
  public onLine(handler: (line: string) => void): void {
    this.lines = handler;
  }

  /**
   * Registers the close handler, which this fake never fires.
   */
  public onClose(): void {
    // The scripted harness never ends on its own.
  }

  /**
   * Ends the harness.
   */
  public close(): void {
    // Nothing to end.
  }

  /**
   * Pushes a message at the provider.
   * @param message The message.
   */
  private emit(message: unknown): void {
    this.lines?.(JSON.stringify(message));
  }

  /**
   * Gets the answers the provider sent back, in order.
   * @returns Returns the answers.
   */
  public answers(): unknown[] {
    return this.sent
      .filter((message: Record<string, unknown>): boolean => message['type'] === 'answer')
      .map((message: Record<string, unknown>): unknown => message['answer']);
  }
}

/**
 * Builds a run context with the fields the provider reads, recording what it was asked.
 * @param harness The scripted harness, unused but kept for symmetry with the provider under test.
 * @param overrides Context fields to replace.
 * @returns Returns the context and the record of what was asked of the user.
 */
function contextFor(overrides: Partial<Record<string, unknown>> = {}): {
  context: AgentRunContext;
  events: unknown[];
  steerHandlers: unknown[];
} {
  const events: unknown[] = [];
  const steerHandlers: unknown[] = [];
  const context: Record<string, unknown> = {
    requestId: 'r1',
    prompt: 'do the thing',
    workspaceRoot: '/ws',
    model: 'm1',
    agentSessionId: null,
    effort: 'high',
    mode: 'agent',
    surface: 'editor',
    allowedWritePaths: ['/ws'],
    deniedWritePaths: ['/ws/secrets'],
    allowedNetworkLocations: ['example.com'],
    deniedNetworkLocations: [],
    tokenCap: 1000,
    resumeSessionId: null,
    forkSession: false,
    signal: new AbortController().signal,
    bridge: { request: (): Promise<unknown> => Promise.resolve('bridged') },
    emit: (event: unknown): void => void events.push(event),
    recordAudit: (): void => undefined,
    setSteerHandler: (handler: unknown): void => void steerHandlers.push(handler),
    requestPermission: (): Promise<boolean> => Promise.resolve(true),
    requestInput: (): Promise<string | null> => Promise.resolve('the answer'),
    requestEditDecision: (): Promise<string> => Promise.resolve('yes'),
    ...overrides,
  };
  return { context: context as unknown as AgentRunContext, events, steerHandlers };
}

describe('HarnessAgentProvider', () => {
  let harness: ScriptedHarness;
  let provider: ProviderType;

  beforeEach(() => {
    harness = new ScriptedHarness();
    provider = new HarnessAgentProvider({
      id: 'demo',
      label: 'Demo Harness',
      models: [{ id: 'm1', label: 'M1', contextWindow: 100 }],
      defaultModelId: 'm1',
      connect: (): ScriptedHarness => harness,
    });
  });

  it('run_handshakesThenSendsTheTurn', async () => {
    const { context } = contextFor();

    await provider.run(context);

    expect(harness.sent[0]?.['type']).toBe('initialize');
    expect(harness.sent[1]?.['type']).toBe('turn.start');
  });

  it('run_streamsTheHarnessEventsThroughTheContextUnchanged', async () => {
    harness.events = [{ requestId: 'r1', kind: 'text', delta: 'hello' }];
    const { context, events } = contextFor();

    await provider.run(context);

    // The whole reason this protocol is tractable: a harness emits the events Studio already renders,
    // so nothing is translated on the way through.
    expect(events).toEqual([{ requestId: 'r1', kind: 'text', delta: 'hello' }]);
  });

  it('run_putsEachKindOfQuestionToTheUserAndAnswersInTheProtocolShape', async () => {
    harness.requests = [
      { kind: 'permission', name: 'Bash', detail: 'ls' },
      { kind: 'input', question: 'which?', choices: ['a', 'b'] },
      { kind: 'edit-decision', name: 'a.ts', detail: 'x', hasDiff: true },
      { kind: 'bridge', capability: 'notify', input: {}, timeoutMs: null },
    ];
    const { context } = contextFor();

    await provider.run(context);

    expect(harness.answers()).toEqual([
      { kind: 'permission', granted: true },
      { kind: 'input', answer: 'the answer' },
      { kind: 'edit-decision', decision: 'yes' },
      { kind: 'bridge', result: 'bridged', error: null },
    ]);
  });

  it('run_deniesAQuestionOfAKindStudioCannotPut', async () => {
    harness.requests = [{ kind: 'invented', please: 'trust me' }];
    const { context } = contextFor();

    await provider.run(context);

    // The host validates the envelope, not the body. A question with nowhere to go is denied rather
    // than guessed at.
    expect(harness.answers()).toEqual([{ kind: 'permission', granted: false }]);
  });

  it('run_offersSteeringOnlyWhenTheHarnessDeclaredIt', async () => {
    harness.steering = false;
    const { context, steerHandlers } = contextFor();

    await provider.run(context);

    // Registered as null, so the renderer queues the message for the next turn exactly as it does for
    // an in-core provider with no steer handler.
    expect(steerHandlers[0]).toBeNull();
  });

  it('run_registersASteerHandlerWhenTheHarnessTakesIt', async () => {
    const { context, steerHandlers } = contextFor();

    await provider.run(context);

    expect(typeof steerHandlers[0]).toBe('function');
  });

  it('run_clearsTheSteerHandlerWhenTheTurnEnds', async () => {
    const { context, steerHandlers } = contextFor();

    await provider.run(context);

    // A handler outliving its turn would accept a steer for a run that has finished.
    expect(steerHandlers.at(-1)).toBeNull();
  });

  it('run_failsWhenTheHarnessCannotBeHosted', async () => {
    harness.version = '99.0.0';
    const { context } = contextFor();

    await expect(provider.run(context)).rejects.toThrow('could not be started');
  });

  it('capabilitiesAreConservativeUntilTheHarnessHasDeclaredThem', async () => {
    // A control offered for a capability the harness turns out not to have is worse than one that
    // appears after the first turn.
    expect(provider.supportsImages).toBe(false);
    expect(provider.supportedEfforts).toEqual([]);
    expect(provider.sessionModel).toBe('stateless');

    await provider.run(contextFor().context);

    expect(provider.supportsImages).toBe(true);
    expect(provider.supportedEfforts).toEqual(['low', 'high']);
    expect(provider.sessionModel).toBe('live-harness');
  });

  it('neverOffersRemoteControl', () => {
    // The protocol carries no message for it: `bridge` is Studio reaching in, not a harness exposing
    // itself outward.
    expect(provider.supportsRemoteControl).toBe(false);
  });
});

describe('toTurnRequest', () => {
  it('carriesTheContextsOwnFieldsAndNothingThatCannotCrossAWire', () => {
    const { context } = contextFor();

    const turn: Record<string, unknown> = toTurnRequest(context) as unknown as Record<
      string,
      unknown
    >;

    expect(turn['requestId']).toBe('r1');
    expect(turn['allowedWritePaths']).toEqual(['/ws']);
    expect(turn['deniedWritePaths']).toEqual(['/ws/secrets']);
    expect(turn['tokenCap']).toBe(1000);
    // The interesting part is what is absent: the live objects become messages instead.
    expect(turn['signal']).toBeUndefined();
    expect(turn['bridge']).toBeUndefined();
    expect(turn['emit']).toBeUndefined();
    expect(turn['requestPermission']).toBeUndefined();
    expect(turn['setSteerHandler']).toBeUndefined();
  });
});
