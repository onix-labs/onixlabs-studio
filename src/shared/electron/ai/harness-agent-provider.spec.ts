import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROTOCOL_VERSION } from '@shared/api/agent-protocol';
import type { AgentRunContext, AgentSession } from './agent-provider';

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
   * Holds the session model the harness declares at the handshake.
   */
  public declaredSessionModel: string = 'live-harness';

  /**
   * Holds whether the harness declares it can expose its session to another machine.
   */
  public declaredRemoteControl: boolean = true;

  /**
   * Holds whether the harness declares it can report its models.
   */
  public declaredDiscovery: boolean = true;

  /**
   * Holds the models the harness reports when asked.
   */
  public declaredModels: readonly { id: string; label?: string }[] = [{ id: 'm1' }];

  /**
   * Holds whether the provider closed the transport.
   */
  public closed: boolean = false;

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
          sessionModel: this.declaredSessionModel,
          steering: this.steering,
          images: true,
          efforts: ['low', 'high'],
          resumable: true,
          remoteControl: this.declaredRemoteControl,
          discovery: this.declaredDiscovery,
        },
      });
      return;
    }
    if (message['type'] === 'discover') {
      this.emit({
        type: 'models',
        discoveryId: message['discoveryId'],
        models: this.declaredModels,
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
    this.closed = true;
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
    auth: { hasLocalLogin: false, hasCodexLogin: false, apiKey: null },
    resumeSessionAt: null,
    permissionPosture: 'auto-edits',
    toolPolicies: { Bash: 'ask' },
    images: [{ mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }],
    contextPaths: [{ path: '/ws/a.ts', kind: 'file' }],
    remoteControl: 'mirror',
    agentShell: '/bin/zsh',
    owningTabId: 'tab-2',
    claudeExecutable: { mode: 'bundled' },
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
      sessionModel: 'stateless',
      remoteControl: false,
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

  it('run_answersACredentialRequestFromWhatStudioHoldsWithoutPromptingAnyone', async () => {
    harness.requests = [{ kind: 'credential' }];
    let prompted: boolean = false;
    const { context } = contextFor({
      auth: { hasLocalLogin: false, hasCodexLogin: false, apiKey: 'sk-test-key' },
      requestPermission: (): Promise<boolean> => {
        prompted = true;
        return Promise.resolve(true);
      },
    });

    await provider.run(context);

    // ⛔ The key was configured in Settings against this connection. Asking again once per turn would
    // be a prompt with only one possible answer, so this is the one blocking request Studio settles
    // from what it already holds.
    expect(harness.answers()).toEqual([{ kind: 'credential', apiKey: 'sk-test-key' }]);
    expect(prompted).toBe(false);
  });

  it('run_answersACredentialRequestWithNullWhenTheConnectionHasNoKey', async () => {
    harness.requests = [{ kind: 'credential' }];
    const { context } = contextFor();

    await provider.run(context);

    expect(harness.answers()).toEqual([{ kind: 'credential', apiKey: null }]);
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

    await provider.run(contextFor().context);

    expect(provider.supportsImages).toBe(true);
    expect(provider.supportedEfforts).toEqual(['low', 'high']);
  });

  it('sessionModelComesFromTheManifestAndDoesNotChangeWhenTheHarnessSpeaks', async () => {
    // ⛔ Deliberately NOT learned from the handshake, unlike every other capability. `dispatchLive` asks
    // this before anything has been started, so an answer that needs a running process arrives after
    // the decision it informs — which produced the worst of both: a transient first turn, then live
    // ones once the answer had been learned. The scripted harness declares `live-harness`; the manifest
    // says `stateless`, and the manifest is what Studio plans around.
    expect(provider.sessionModel).toBe('stateless');

    await provider.run(contextFor().context);

    expect(provider.sessionModel).toBe('stateless');
  });

  it('discoverModels_returnsWhatTheHarnessReports', async () => {
    harness.declaredModels = [{ id: 'x1', label: 'Model X1' }];

    const models: readonly { id: string; label?: string }[] | null = await provider.discoverModels({
      hasLocalLogin: false,
      hasCodexLogin: false,
      apiKey: null,
    });

    expect(models).toEqual([{ id: 'x1', label: 'Model X1' }]);
  });

  it('discoverModels_doesNotAskAHarnessThatDidNotDeclareIt', async () => {
    // ⛔ The guard that stops an unimplemented message hanging. `discover` must be answered, and a
    // harness ignoring one it never heard of would leave this awaiting a reply that never comes.
    harness.declaredDiscovery = false;

    const models: readonly { id: string; label?: string }[] | null = await provider.discoverModels({
      hasLocalLogin: false,
      hasCodexLogin: false,
      apiKey: null,
    });

    expect(models).toBeNull();
    expect(
      harness.sent.some(
        (message: Record<string, unknown>): boolean => message['type'] === 'discover',
      ),
    ).toBe(false);
  });

  it('offersRemoteControlOnlyWhenItsManifestDeclaresIt', () => {
    // Static, like the session model, and for the same reason: the control is drawn in the agent ribbon
    // from what `listProviders` reported at start-up, long before anything has been spawned.
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

  it('carriesEveryFieldAHarnessNeedsToReachParityWithAnInCoreProvider', () => {
    // 🔑 Protocol 1.2.0. The envelope carried 16 of the run context's 29 fields, so a harness could not
    // see the posture it was running under, the tool policies, the attached images or context, the
    // remote-control mode, the shell, or the owning tab. The ceiling on an out-of-process provider was
    // the wire rather than the port, and this is where that stopped being true.
    const { context } = contextFor();

    const turn: Record<string, unknown> = toTurnRequest(context) as unknown as Record<
      string,
      unknown
    >;

    expect(turn['permissionPosture']).toBe('auto-edits');
    expect(turn['toolPolicies']).toEqual({ Bash: 'ask' });
    expect(turn['images']).toEqual([{ mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }]);
    expect(turn['contextPaths']).toEqual([{ path: '/ws/a.ts', kind: 'file' }]);
    expect(turn['remoteControl']).toBe('mirror');
    expect(turn['agentShell']).toBe('/bin/zsh');
    expect(turn['owningTabId']).toBe('tab-2');
    expect(turn['resumeSessionAt']).toBeNull();
  });

  it('carriesAVendorsOwnSettingInTheOpaqueBagRatherThanAsANamedField', () => {
    // ⛔ A wire field called `claudeExecutable` would be the seam naming a vendor. The setting still
    // reaches the harness that understands it; the protocol simply does not know what it means.
    const { context } = contextFor();

    const turn: Record<string, unknown> = toTurnRequest(context) as unknown as Record<
      string,
      unknown
    >;

    expect(turn['claudeExecutable']).toBeUndefined();
    expect(turn['providerSettings']).toEqual({ claudeExecutable: { mode: 'bundled' } });
  });

  it('omitsAnOptionalFieldRatherThanSendingItUndefined', () => {
    // `exactOptionalPropertyTypes` aside, an explicit `undefined` survives neither `JSON.stringify` nor
    // a strict reader on the far end. An absent name is absent.
    const { context } = contextFor({
      images: [{ mediaType: 'image/png', data: 'AAAA' }],
      contextPaths: [{ path: '/ws/a.ts', kind: 'selection', content: 'x' }],
    });

    const turn: Record<string, unknown> = toTurnRequest(context) as unknown as Record<
      string,
      unknown
    >;

    expect(JSON.stringify(turn['images'])).toBe('[{"mediaType":"image/png","data":"AAAA"}]');
    expect(turn['contextPaths']).toEqual([{ path: '/ws/a.ts', kind: 'selection', content: 'x' }]);
  });
});

describe('HarnessAgentSession', () => {
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
      sessionModel: 'live-harness',
      remoteControl: true,
    });
  });

  it('handshakesOnceAndKeepsTheProcessAcrossTurns', async () => {
    // 🔑 The whole point. A transient run builds and closes a host per turn, so turn two starts a model
    // that has never heard of turn one. A session hands both turns to the same process, which is what
    // lets a `live-harness` keep the conversation in its own memory instead of Studio replaying it.
    const session: AgentSession = provider.openSession(contextFor().context);

    await session.turn(contextFor().context);
    await session.turn(contextFor({ requestId: 'r2' }).context);

    const handshakes: number = harness.sent.filter(
      (message: Record<string, unknown>): boolean => message['type'] === 'initialize',
    ).length;
    const turns: number = harness.sent.filter(
      (message: Record<string, unknown>): boolean => message['type'] === 'turn.start',
    ).length;
    expect(handshakes).toBe(1);
    expect(turns).toBe(2);
    expect(harness.closed).toBe(false);
  });

  it('takesItsSessionIdFromTheStreamRatherThanFromTheSettle', async () => {
    // A `live-harness` has a conversation as soon as it starts one, part way through the first turn —
    // not when that turn ends. Reading it from the settle would leave the id null for the whole of the
    // turn that created it, and a reap in that window would reopen with nothing to resume.
    harness.events = [{ requestId: 'r1', kind: 'session', sessionId: 'thread-7' }];
    const session: AgentSession = provider.openSession(contextFor().context);

    await session.turn(contextFor().context);

    expect(session.id).toBe('thread-7');
  });

  it('refusesAHarnessWhoseHandshakeContradictsItsManifest', async () => {
    // ⛔ Studio has already committed to holding a process open on the manifest's word. A `stateless`
    // harness kept alive would collect turns it cannot relate to one another, which reads to the user
    // as a model that has forgotten the conversation and leaves nothing in the log to say why.
    harness.declaredSessionModel = 'stateless';
    const session: AgentSession = provider.openSession(contextFor().context);

    await expect(session.turn(contextFor().context)).rejects.toThrow('in its manifest');
    expect(session.alive).toBe(false);
  });

  it('interruptStopsTheTurnAndLeavesTheSessionOpen', async () => {
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    session.interrupt();

    // Nothing to abort once the turn has settled, and — the part that matters — the process is still up
    // for the next one. Interrupting a session is not closing it.
    expect(harness.closed).toBe(false);
    expect(session.alive).toBe(true);
  });

  it('aimsRemoteControlAtTheOpenSessionRatherThanWaitingForTheNextTurn', async () => {
    // ⛔ Session-scoped on purpose. A user toggling the control expects it to land on the conversation
    // in front of them — including between turns, and mid-turn. For a held-open session the "next turn"
    // could be never, so an aim that only took effect at turn start would dangle indefinitely.
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    session.setRemoteControl?.('control');

    expect(harness.sent).toContainEqual({ type: 'remote-control', mode: 'control' });
  });

  it('doesNotAimRemoteControlAtAHarnessThatDidNotConfirmIt', async () => {
    // ⚠️ Warned about, not refused — deliberately unlike a session-model mismatch. There the symptom is
    // a conversation that silently forgets itself; here it is a toggle that does nothing, and killing a
    // working provider over the second would cost more than the fault it reports.
    harness.declaredRemoteControl = false;
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    session.setRemoteControl?.('mirror');

    expect(
      harness.sent.some(
        (message: Record<string, unknown>): boolean => message['type'] === 'remote-control',
      ),
    ).toBe(false);
    expect(session.alive).toBe(true);
  });

  it('closeEndsTheProcessAndIsIdempotent', async () => {
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    await session.close();
    await session.close();

    expect(harness.closed).toBe(true);
    expect(session.alive).toBe(false);
  });
});
