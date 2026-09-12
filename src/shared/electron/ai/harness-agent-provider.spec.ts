import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROTOCOL_VERSION } from '@shared/api/agent-protocol';
import type { AgentModelReport, AgentRunContext, AgentSession } from './agent-provider';
import { ASK_USER } from '@shared/api/ai/ai-tool-surface';

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
   * Holds the host messages the harness declares it answers.
   */
  public declaredAnswers: readonly string[] = ['steer', 'discover', 'remote-control'];

  /**
   * Holds the protocol version the harness declares.
   */
  public version: string = AGENT_PROTOCOL_VERSION;

  /**
   * Holds the session model the harness declares at the handshake.
   */
  public declaredSessionModel: string = 'live-harness';

  /**
   * Holds the models the harness reports when asked.
   */
  public declaredModels: readonly { id: string; label?: string }[] = [{ id: 'm1' }];

  /**
   * Holds whether the provider closed the transport.
   */
  public closed: boolean = false;

  /**
   * Holds whether this harness settles the turns it is given. Set false to model one that has wedged,
   * which is the only case a panic stop's escalation can be observed in.
   */
  public settlesTurns: boolean = true;

  /**
   * Holds the line handler.
   */
  private lines: ((line: string) => void) | null = null;

  /**
   * Holds the run awaiting settlement, or null when none is.
   */
  private settling: string | null = null;

  /**
   * Counts the answers received for the turn in flight.
   */
  private answered: number = 0;

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
          answers: this.declaredAnswers,
          images: true,
          efforts: ['low', 'high'],
          resumable: true,
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
      this.settling = requestId;
      this.answered = 0;
      for (const [index, request] of this.requests.entries()) {
        this.emit({ type: 'request', callId: `c${index}`, requestId, request });
      }
      // ⚠️ A turn with no questions settles on a later tick; one with questions settles only once every
      // answer has arrived. Settling on a timer instead was wrong the moment an answer became genuinely
      // asynchronous — describing Studio's tools awaits an import — and the turn ended before the reply
      // it was waiting for, which looked like the answer never being sent.
      if (this.requests.length === 0) {
        queueMicrotask((): void => this.settle());
      }
      return;
    }
    if (message['type'] === 'answer') {
      this.answered += 1;
      if (this.answered >= this.requests.length) {
        this.settle();
      }
    }
  }

  /**
   * Completes the turn in flight, once.
   */
  private settle(): void {
    if (!this.settlesTurns) {
      return;
    }
    const requestId: string | null = this.settling;
    this.settling = null;
    if (requestId !== null) {
      this.emit({ type: 'turn.completed', requestId, sessionId: 's1' });
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
    auth: { apiKey: null },
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
      settings: {},
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

  it('run_carriesEachChoicesExplanationThroughToThePrompt', async () => {
    // 1.9.0 widened a choice from a bare label to `{ label, description }`. `AiInputChoice` always had
    // somewhere to put the explanation and the wire was flattening it away — which is most of what
    // makes a choice answerable rather than a guess between two words.
    harness.requests = [
      {
        kind: 'input',
        question: 'which?',
        choices: [{ label: 'Rebase', description: 'keeps history linear' }, { label: 'Merge' }],
      },
    ];
    let offered: unknown = null;
    const { context } = contextFor({
      requestInput: (_question: string, choices: unknown): Promise<string | null> => {
        offered = choices;
        return Promise.resolve('Rebase');
      },
    });

    await provider.run(context);

    expect(offered).toEqual([
      { label: 'Rebase', description: 'keeps history linear' },
      { label: 'Merge' },
    ]);
  });

  it('run_stillAcceptsTheBareLabelsEveryOlderHarnessSends', async () => {
    // ⚠️ Every harness published before 1.9.0 sends strings, and a shape that refused them would break
    // the ones already installed on somebody's machine.
    harness.requests = [{ kind: 'input', question: 'which?', choices: ['a', 'b'] }];
    let offered: unknown = null;
    const { context } = contextFor({
      requestInput: (_question: string, choices: unknown): Promise<string | null> => {
        offered = choices;
        return Promise.resolve('a');
      },
    });

    await provider.run(context);

    expect(offered).toEqual([{ label: 'a' }, { label: 'b' }]);
  });

  it('run_dropsAChoiceThatIsNeitherALabelNorAString', async () => {
    // ⛔ Dropped rather than coerced, on the same grounds as every other text field from a harness:
    // these reach a prompt the user is about to answer, and `[object Object]` as an option is worse
    // than one option fewer.
    harness.requests = [
      { kind: 'input', question: 'which?', choices: [{ label: 'ok' }, { nope: 1 }, 42, null] },
    ];
    let offered: unknown = null;
    const { context } = contextFor({
      requestInput: (_question: string, choices: unknown): Promise<string | null> => {
        offered = choices;
        return Promise.resolve('ok');
      },
    });

    await provider.run(context);

    expect(offered).toEqual([{ label: 'ok' }]);
  });

  it('run_withholdsAToolTheHarnessSaysItAlreadyHas', async () => {
    // A harness whose model brings its own version of one of Studio's tools names it in `omit`. Being
    // handed both would give the model two ways to do one thing, described differently — and which
    // one it reaches for would depend on which description it read first.
    harness.requests = [{ kind: 'tools', omit: [ASK_USER] }];
    const { context } = contextFor();

    await provider.run(context);

    const answer: { kind: string; tools: readonly { name: string }[] } = harness.answers()[0] as {
      kind: string;
      tools: readonly { name: string }[];
    };
    expect(answer.tools.some((tool: { name: string }): boolean => tool.name === ASK_USER)).toBe(
      false,
    );
    expect(answer.tools.length).toBeGreaterThan(0);
  });

  it('run_stopsNamingStudiosAskToolOnceAHarnessProvidesItsOwn', async () => {
    // 🔑 Why `omit` says what the harness *has* rather than what to withhold: the instructions
    // describe the tools, so a model told to "ask with the ask_user tool" it was never given either
    // invents one or quietly guesses instead. It still has to be told to ask.
    harness.requests = [{ kind: 'tools', omit: [ASK_USER] }];
    const { context } = contextFor();

    await provider.run(context);

    const answer: { systemPrompt: string } = harness.answers()[0] as { systemPrompt: string };
    expect(answer.systemPrompt).not.toContain(`"${ASK_USER}"`);
    expect(answer.systemPrompt).toContain('ask a clarifying question');
  });

  it('run_answersACredentialRequestFromWhatStudioHoldsWithoutPromptingAnyone', async () => {
    harness.requests = [{ kind: 'credential' }];
    let prompted: boolean = false;
    const { context } = contextFor({
      auth: { apiKey: 'sk-test-key' },
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

  it('run_describesStudiosToolsWhenAskedAndWithholdsDeniedOnes', async () => {
    // ⛔ Matthew's ruling: a denied tool is omitted entirely, not listed and refused. The model is never
    // told it exists — it cannot reach for what it has not been shown, and a denial it cannot see is a
    // denial it cannot keep pushing against.
    harness.requests = [{ kind: 'tools' }];
    const { context } = contextFor({
      surface: 'editor',
      mode: 'agent',
      toolPolicies: { [ASK_USER]: 'deny' },
    });

    await provider.run(context);

    const answer: { kind: string; tools: readonly { name: string }[] } = harness.answers()[0] as {
      kind: string;
      tools: readonly { name: string }[];
    };
    expect(answer.kind).toBe('tools');
    expect(answer.tools.length).toBeGreaterThan(0);
    expect(answer.tools.map((t: { name: string }): string => t.name)).not.toContain(ASK_USER);
  });

  it('run_sendsStudiosInstructionsAlongsideTheToolsTheyDescribe', async () => {
    // ⛔ The two travel together because the instructions describe the tools: what this surface is, how
    // to use them, and — in a chat turn — that it may read but not act. A harness given the tools but
    // not the instructions would have had to write its own, and two descriptions of one set of
    // capabilities drift in exactly the way this seam exists to prevent.
    harness.requests = [{ kind: 'tools' }];
    const { context } = contextFor({ surface: 'editor', mode: 'agent' });

    await provider.run(context);

    const answer: { systemPrompt: string } = harness.answers()[0] as { systemPrompt: string };
    expect(answer.systemPrompt.length).toBeGreaterThan(0);
  });

  it('run_tellsAChatTurnItMayNotAct', async () => {
    // The read-only appendix is part of what makes a chat turn a chat turn for a harness that has no
    // other way to know: its tools are already withheld, and this says why.
    harness.requests = [{ kind: 'tools' }];
    const { context } = contextFor({ surface: 'editor', mode: 'chat' });

    await provider.run(context);

    const chat: { systemPrompt: string } = harness.answers()[0] as { systemPrompt: string };
    const { context: agentContext } = contextFor({ surface: 'editor', mode: 'agent' });
    harness.sent.length = 0;
    await provider.run(agentContext);
    const agent: { systemPrompt: string } = harness.answers()[0] as { systemPrompt: string };

    expect(chat.systemPrompt).not.toBe(agent.systemPrompt);
  });

  it('run_carriesTheConnectionSettingsAHarnessNeedsToBuildAClient', () => {
    // 🔑 The envelope is turn-scoped and says nothing about which endpoint or provider kind a connection
    // points at — facts a harness talking to a plain model API needs before it can build a client at
    // all. They ride in the opaque bag rather than as named wire fields, because the protocol must not
    // name one vendor's concepts.
    const turn: Record<string, unknown> = toTurnRequest(contextFor().context, {
      connectionKind: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    }) as unknown as Record<string, unknown>;

    expect(turn['providerSettings']).toEqual({
      connectionKind: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      claudeExecutable: { mode: 'bundled' },
    });
  });

  it('run_describesEachToolWithAJsonSchemaRatherThanTheSchemaStudioHolds', async () => {
    // The schema Studio holds is a Zod object, which does not survive a pipe. Converting it — rather
    // than hand-writing a second description of the same shape — is what stops the two drifting into a
    // model calling a tool with arguments Studio then rejects.
    harness.requests = [{ kind: 'tools' }];
    const { context } = contextFor({ surface: 'editor', mode: 'agent' });

    await provider.run(context);

    const answer: { tools: readonly { inputSchema: { type?: string } }[] } =
      harness.answers()[0] as {
        tools: readonly { inputSchema: { type?: string } }[];
      };
    expect(answer.tools[0].inputSchema.type).toBe('object');
  });

  it('run_refusesToRunAToolStudioDoesNotHave', async () => {
    harness.requests = [{ kind: 'tool', name: 'not_a_tool', input: {} }];
    const { context } = contextFor({ surface: 'editor', mode: 'agent' });

    await provider.run(context);

    // Named rather than silently failed: a harness reaching for a tool it was never shown is either
    // confused or trying its luck, and either way the answer should say so.
    expect(harness.answers()[0]).toEqual({
      kind: 'tool',
      result: null,
      error: "Studio has no tool called 'not_a_tool'.",
    });
  });

  it('run_refusesToRunADeniedToolEvenWhenItWasNeverDescribed', async () => {
    // ⛔ Defence in depth. Withholding the description stops the *model* reaching for it; this stops a
    // *harness* reaching past the list it was given.
    harness.requests = [{ kind: 'tool', name: ASK_USER, input: { question: 'hi', choices: [] } }];
    const { context } = contextFor({
      surface: 'editor',
      mode: 'agent',
      toolPolicies: { [ASK_USER]: 'deny' },
    });

    await provider.run(context);

    const answer: { error: string | null } = harness.answers()[0] as { error: string | null };
    expect(answer.error).toContain('Deny');
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
    harness.declaredAnswers = [];
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

    const report: AgentModelReport | null = await provider.discoverModels({
      apiKey: null,
    });

    expect(report?.models).toEqual([{ id: 'x1', label: 'Model X1' }]);
    // A harness that reported models says nothing about why it did not, and core phrases the success.
    expect(report?.detail).toBeNull();
  });

  it('discoverModels_doesNotAskAHarnessThatDidNotDeclareIt', async () => {
    // ⛔ The guard that stops an unimplemented message hanging. `discover` must be answered, and a
    // harness ignoring one it never heard of would leave this awaiting a reply that never comes.
    harness.declaredAnswers = ['steer'];

    const report: AgentModelReport | null = await provider.discoverModels({
      apiKey: null,
    });

    expect(report).toBeNull();
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
      settings: {},
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
    harness.declaredAnswers = ['steer'];
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

  it('stopTask_asksTheHarnessToStopTheWorkItOwns', async () => {
    // ⛔ Session-scoped rather than turn-scoped: a backgrounded task outlives the turn that launched
    // it, so by the time the user presses Stop the run id it started under may have settled long ago.
    // The harness owns the registry of what is running; Studio only names one.
    harness.declaredAnswers = ['task.stop'];
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    session.stopTask?.('task-9');

    expect(harness.sent).toContainEqual({ type: 'task.stop', taskId: 'task-9' });
  });

  it('stopTask_isANoOpForAHarnessThatDoesNotAnswerIt', async () => {
    harness.declaredAnswers = [];
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    session.stopTask?.('task-9');

    // Never sent rather than sent and ignored: an unanswered host message hangs whoever sent it.
    expect(
      harness.sent.some(
        (message: Record<string, unknown>): boolean => message['type'] === 'task.stop',
      ),
    ).toBe(false);
    expect(session.alive).toBe(true);
  });

  it('panicStop_asksTheHarnessToStopEverythingBeforeEscalating', async () => {
    harness.declaredAnswers = ['panic'];
    const session: AgentSession = provider.openSession(contextFor().context);
    await session.turn(contextFor().context);

    session.panicStop?.();

    expect(harness.sent).toContainEqual({ type: 'panic' });
    // Asked first, not killed first: a healthy harness settles its turns and the watchdog never fires.
    expect(harness.closed).toBe(false);
  });

  it('panicStop_closesTheSessionWhenTheHarnessDoesNotSettleItsTurns', async () => {
    // ⛔ The escalation is the point. The user's Stop is a promise that everything halts, and a wedged
    // harness is precisely the case it exists for — so a harness that has not gone quiet within the
    // grace period has the transport closed under it.
    vi.useFakeTimers();
    try {
      harness.settlesTurns = false;
      const session: AgentSession = provider.openSession(contextFor().context);
      void session.turn(contextFor().context);
      await vi.advanceTimersByTimeAsync(0);

      session.panicStop?.();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(harness.closed).toBe(true);
      expect(session.alive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
