import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROTOCOL_VERSION, HarnessAnswer } from '@shared/api/agent-protocol';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { HarnessHost, refusalFor } = await import('./harness-host');
type HarnessHostType = InstanceType<typeof HarnessHost>;

/**
 * A transport that records what was sent and lets a test push lines back, standing in for a harness
 * process without spawning one.
 */
class FakeTransport {
  /**
   * Holds the messages the host sent, parsed.
   */
  public readonly sent: Record<string, unknown>[] = [];

  /**
   * Holds whether the host closed the transport.
   */
  public closed: boolean = false;

  /**
   * Holds the host's line handler.
   */
  private lineHandler: ((line: string) => void) | null = null;

  /**
   * Holds the host's close handler.
   */
  private closeHandler: ((reason: string) => void) | null = null;

  /**
   * Records a message from the host.
   * @param line The serialised message.
   */
  public send(line: string): void {
    this.sent.push(JSON.parse(line) as Record<string, unknown>);
  }

  /**
   * Registers the line handler.
   * @param handler The handler.
   */
  public onLine(handler: (line: string) => void): void {
    this.lineHandler = handler;
  }

  /**
   * Registers the close handler.
   * @param handler The handler.
   */
  public onClose(handler: (reason: string) => void): void {
    this.closeHandler = handler;
  }

  /**
   * Marks the transport closed.
   */
  public close(): void {
    this.closed = true;
  }

  /**
   * Pushes a message from the harness to the host.
   * @param message The message the harness sends.
   */
  public emit(message: unknown): void {
    this.lineHandler?.(JSON.stringify(message));
  }

  /**
   * Pushes a raw line, for the malformed cases.
   * @param line The line.
   */
  public emitRaw(line: string): void {
    this.lineHandler?.(line);
  }

  /**
   * Ends the harness.
   * @param reason Why it ended.
   */
  public end(reason: string): void {
    this.closeHandler?.(reason);
  }
}

/**
 * Builds a well-formed `ready` message.
 * @param overrides Capability fields to replace.
 * @returns Returns the message.
 */
function ready(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'ready',
    capabilities: {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      sessionModel: 'live-harness',
      answers: ['steer', 'discover', 'remote-control'],
      images: false,
      efforts: [],
      resumable: true,
      ...overrides,
    },
  };
}

describe('HarnessHost', () => {
  let transport: FakeTransport;
  let audits: string[];
  let host: HarnessHostType;

  beforeEach(() => {
    transport = new FakeTransport();
    audits = [];
    host = new HarnessHost(
      transport,
      (requestId: string, name: string): void => void audits.push(`${requestId}:${name}`),
    );
  });

  it('initialize_sendsTheHandshakeAndResolvesOnReady', async () => {
    const pending: Promise<unknown> = host.initialize();
    // The settings ride the handshake from 1.8.0, and an empty bag is sent rather than the field being
    // omitted: a harness reading it should not have to tell "no settings" from "an older host".
    expect(transport.sent[0]).toEqual({
      type: 'initialize',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      settings: {},
    });

    transport.emit(ready());

    expect(await pending).not.toBeNull();
    expect(host.capabilities?.sessionModel).toBe('live-harness');
  });

  it('initialize_tellsTheHarnessWhichConnectionItServesBeforeItDeclaresAnything', async () => {
    // 🔑 What 1.8.0 exists for. A harness talking to a plain model API cannot say whether it accepts
    // images without knowing the provider, and `discover` arrives with no turn envelope at all — so the
    // first message it receives has to carry the connection's shape.
    const pending: Promise<unknown> = host.initialize({ connectionKind: 'ollama', baseUrl: null });

    expect(transport.sent[0]).toEqual({
      type: 'initialize',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      settings: { connectionKind: 'ollama', baseUrl: null },
    });

    transport.emit(ready());
    expect(await pending).not.toBeNull();
  });

  it('initialize_refusesAHarnessSpeakingAVersionThisBuildCannotHonour', async () => {
    const pending: Promise<unknown> = host.initialize();

    transport.emit(ready({ protocolVersion: '99.0.0' }));

    // Refused at the handshake, before it is ever given a turn: an incompatibility should be a clear
    // failure to start, not a turn that quietly does less than it was asked.
    expect(await pending).toBeNull();
    expect(transport.closed).toBe(true);
  });

  it('runTurn_sendsTheEnvelopeAndResolvesWhenTheHarnessCompletesIt', async () => {
    const settled: Promise<void> = host.runTurn(
      { requestId: 'r1' },
      { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
    );
    expect(transport.sent.at(-1)).toEqual({ type: 'turn.start', turn: { requestId: 'r1' } });

    transport.emit({ type: 'turn.completed', requestId: 'r1', sessionId: 's1' });

    await expect(settled).resolves.toBeUndefined();
  });

  it('runTurn_rejectsWhenTheHarnessFailsTheTurn', async () => {
    const settled: Promise<void> = host.runTurn(
      { requestId: 'r1' },
      { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
    );

    transport.emit({ type: 'turn.failed', requestId: 'r1', error: 'model refused' });

    await expect(settled).rejects.toThrow('model refused');
  });

  it('event_reachesOnlyTheTurnItNames', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    void host.runTurn(
      { requestId: 'r1' },
      {
        onEvent: (event: unknown): void => void first.push(event),
        onRequest: (): Promise<HarnessAnswer> => neverAnswers(),
      },
    );
    void host.runTurn(
      { requestId: 'r2' },
      {
        onEvent: (event: unknown): void => void second.push(event),
        onRequest: (): Promise<HarnessAnswer> => neverAnswers(),
      },
    );

    transport.emit({ type: 'event', event: { requestId: 'r2', kind: 'text', delta: 'hi' } });

    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
  });

  it('request_answersUnderTheCallIdItWasAskedWith', async () => {
    void host.runTurn(
      { requestId: 'r1' },
      {
        onEvent: (): void => undefined,
        onRequest: (): Promise<HarnessAnswer> =>
          Promise.resolve({ kind: 'permission', granted: true }),
      },
    );

    transport.emit({
      type: 'request',
      callId: 'c1',
      requestId: 'r1',
      request: { kind: 'permission', name: 'Bash', detail: 'ls' },
    });
    await Promise.resolve();

    expect(transport.sent.at(-1)).toEqual({
      type: 'answer',
      callId: 'c1',
      answer: { kind: 'permission', granted: true },
    });
  });

  it('request_forAnUnknownRunIsRefusedRatherThanLeftHanging', () => {
    transport.emit({
      type: 'request',
      callId: 'c1',
      requestId: 'ghost',
      request: { kind: 'input', question: 'which?', choices: [] },
    });

    // A question about a turn that is not running cannot be put to the user meaningfully, and leaving
    // the harness blocked forever is worse than refusing it — in the shape it asked in.
    expect(transport.sent.at(-1)).toEqual({
      type: 'answer',
      callId: 'c1',
      answer: { kind: 'input', answer: null },
    });
  });

  it('abort_refusesEverythingThatTurnIsWaitingOn', () => {
    void host.runTurn(
      { requestId: 'r1' },
      { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
    );
    transport.emit({
      type: 'request',
      callId: 'c1',
      requestId: 'r1',
      request: { kind: 'edit-decision', name: 'a.ts', detail: 'x', hasDiff: true },
    });

    host.abort('r1');

    // Sent locally rather than waited for: a harness that has stopped answering is exactly the case
    // abort exists for, and a prompt outliving its turn is the failure to avoid.
    expect(transport.sent).toContainEqual({
      type: 'answer',
      callId: 'c1',
      answer: { kind: 'edit-decision', decision: 'no' },
    });
    expect(transport.sent.at(-1)).toEqual({ type: 'turn.abort', requestId: 'r1' });
  });

  it('sendsTheMandatoryMessagesEvenToAHarnessThatListedNothing', async () => {
    // ⛔ `initialize`, `turn.start`, `turn.abort` and `answer` are never gated. A harness that cannot
    // handle them is not a harness, and gating `initialize` would be circular: the list that would
    // permit it only arrives in the reply to it.
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: [] }));
    await pending;

    void host.runTurn(
      { requestId: 'r1' },
      { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
    );
    host.abort('r1');

    const types: readonly unknown[] = transport.sent.map(
      (message: Record<string, unknown>): unknown => message['type'],
    );
    expect(types).toContain('initialize');
    expect(types).toContain('turn.start');
    expect(types).toContain('turn.abort');
  });

  it('refusesToSendAnyOptionalMessageAHarnessDidNotList', async () => {
    // 🔑 The whole point of one list rather than a flag per feature. An unanswered message does not fail
    // — it *hangs*, because nothing resolves. Not sending it turns that into an immediate "cannot".
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: [] }));
    await pending;

    expect(host.steer('r1', 'stop')).toBe(false);
    expect(host.setRemoteControl('mirror')).toBe(false);
    await expect(
      host.discover('d1', {
        onEvent: (): void => undefined,
        onRequest: (): Promise<HarnessAnswer> => neverAnswers(),
      }),
    ).resolves.toBeNull();

    const optional: readonly string[] = ['steer', 'remote-control', 'discover'];
    expect(
      transport.sent.filter((message: Record<string, unknown>): boolean =>
        optional.includes(message['type'] as string),
      ),
    ).toEqual([]);
  });

  it('discover_carriesTheReasonAHarnessGaveForAnEmptyList', async () => {
    // 1.4.0 gave a harness a way to report models and no way to report why it could not, so every
    // failure reached Settings as the same sentence. "Could not reach your Ollama server" is something
    // a user can go and fix; "reported no models" is not.
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready());
    await pending;

    const discovering: Promise<unknown> = host.discover('d1', {
      onEvent: (): void => undefined,
      onRequest: (): Promise<HarnessAnswer> => neverAnswers(),
    });
    transport.emit({
      type: 'models',
      discoveryId: 'd1',
      models: [],
      detail: 'Could not reach http://127.0.0.1:11434/v1/models.',
    });

    expect(await discovering).toEqual({
      models: [],
      detail: 'Could not reach http://127.0.0.1:11434/v1/models.',
    });
  });

  it('discover_refusesADetailThatIsNotText', async () => {
    // ⚠️ This reaches a settings dialog. A harness that sent an object would put `[object Object]` in
    // front of somebody trying to work out why their connection does not run.
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready());
    await pending;

    const discovering: Promise<unknown> = host.discover('d1', {
      onEvent: (): void => undefined,
      onRequest: (): Promise<HarnessAnswer> => neverAnswers(),
    });
    transport.emit({ type: 'models', discoveryId: 'd1', models: [], detail: { why: 'nope' } });

    expect(await discovering).toEqual({ models: [], detail: null });
  });

  it('treatsAHarnessThatSendsNoListAsAnsweringOnlyTheMandatoryFour', async () => {
    // ⚠️ What keeps an already-published plugin working. A harness on an older minor has never heard of
    // `answers`, so it sends none — and is simply not offered the optional messages.
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: undefined }));
    await pending;

    expect(host.steer('r1', 'stop')).toBe(false);
    expect(host.capabilities).not.toBeNull();
  });

  it('steer_isRefusedWhenTheHarnessDidNotDeclareIt', async () => {
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: [] }));
    await pending;

    expect(host.steer('r1', 'actually, stop')).toBe(false);
    expect(
      transport.sent.some((m: Record<string, unknown>): boolean => m['type'] === 'steer'),
    ).toBe(false);
  });

  it('steer_isSentWhenTheHarnessDeclaredIt', async () => {
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: ['steer'] }));
    await pending;

    expect(host.steer('r1', 'actually, stop')).toBe(true);
    expect(transport.sent.at(-1)).toEqual({
      type: 'steer',
      requestId: 'r1',
      text: 'actually, stop',
    });
  });

  it('cancel_dismissesThePromptWithoutAnsweringTheHarness', () => {
    // 🔑 The case this exists for: the harness raced Studio's prompt against a peer on claude.ai and
    // the peer answered first. Studio's prompt must come off the screen — but no answer may be sent,
    // because the harness has already accepted one from somewhere else and a stale refusal arriving
    // on top of it could overwrite the decision it just took.
    let dismissed: boolean = false;
    void host.runTurn(
      { requestId: 'r1' },
      {
        onEvent: (): void => undefined,
        onRequest: (_request: unknown, dismiss: AbortSignal): Promise<HarnessAnswer> => {
          dismiss.addEventListener('abort', (): void => void (dismissed = true));
          return neverAnswers();
        },
      },
    );
    transport.emit({
      type: 'request',
      callId: 'c1',
      requestId: 'r1',
      request: { kind: 'permission', name: 'Bash', detail: 'ls' },
    });

    transport.emit({ type: 'cancel', callId: 'c1' });

    expect(dismissed).toBe(true);
    expect(
      transport.sent.some((m: Record<string, unknown>): boolean => m['type'] === 'answer'),
    ).toBe(false);
  });

  it('cancel_forACallAlreadySettledIsIgnored', () => {
    // Ordinary rather than exceptional: the user can answer at the same moment the peer does, and
    // whichever message crosses second finds nothing to withdraw.
    void host.runTurn(
      { requestId: 'r1' },
      { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
    );

    expect((): void => transport.emit({ type: 'cancel', callId: 'never-asked' })).not.toThrow();
  });

  it('cancel_withoutACallIdIsRefusedRatherThanReadAsWithdrawEverything', () => {
    let dismissed: boolean = false;
    void host.runTurn(
      { requestId: 'r1' },
      {
        onEvent: (): void => undefined,
        onRequest: (_request: unknown, dismiss: AbortSignal): Promise<HarnessAnswer> => {
          dismiss.addEventListener('abort', (): void => void (dismissed = true));
          return neverAnswers();
        },
      },
    );
    transport.emit({
      type: 'request',
      callId: 'c1',
      requestId: 'r1',
      request: { kind: 'permission', name: 'Bash', detail: 'ls' },
    });

    transport.emit({ type: 'cancel' });

    // The validator refuses it, so a malformed cancel cannot dismiss a prompt the user is part way
    // through answering — which is the one thing a cancel naming nothing could otherwise be read as.
    expect(dismissed).toBe(false);
  });

  it('abort_dismissesThePromptItRefuses', () => {
    // Refusing the harness is only half of it: a stopped turn that leaves its permission card on
    // screen leaves the user able to answer into a run that has already ended.
    let dismissed: boolean = false;
    void host.runTurn(
      { requestId: 'r1' },
      {
        onEvent: (): void => undefined,
        onRequest: (_request: unknown, dismiss: AbortSignal): Promise<HarnessAnswer> => {
          dismiss.addEventListener('abort', (): void => void (dismissed = true));
          return neverAnswers();
        },
      },
    );
    transport.emit({
      type: 'request',
      callId: 'c1',
      requestId: 'r1',
      request: { kind: 'permission', name: 'Bash', detail: 'ls' },
    });

    host.abort('r1');

    expect(dismissed).toBe(true);
  });

  it('stopTask_andPanic_areGatedOnWhatTheHarnessAnswers', async () => {
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: [] }));
    await pending;

    // Not merely unanswered: never sent. A host message a harness has never heard of leaves the
    // caller awaiting a reply forever, so "cannot" has to be immediate.
    expect(host.stopTask('t1')).toBe(false);
    expect(host.panic()).toBe(false);
    const types: readonly unknown[] = transport.sent.map(
      (message: Record<string, unknown>): unknown => message['type'],
    );
    expect(types).not.toContain('task.stop');
    expect(types).not.toContain('panic');
  });

  it('stopTask_andPanic_areSentWhenTheHarnessDeclaredThem', async () => {
    const pending: Promise<unknown> = host.initialize();
    transport.emit(ready({ answers: ['task.stop', 'panic'] }));
    await pending;

    expect(host.stopTask('t1')).toBe(true);
    expect(transport.sent.at(-1)).toEqual({ type: 'task.stop', taskId: 't1' });
    expect(host.panic()).toBe(true);
    expect(transport.sent.at(-1)).toEqual({ type: 'panic' });
  });

  it('close_failsEveryTurnInFlightRatherThanLeavingThemWorkingForever', async () => {
    const settled: Promise<void> = host.runTurn(
      { requestId: 'r1' },
      { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
    );

    transport.end('exited with code 1');

    // Nothing remains to stream its events or resolve it, so a turn whose harness has gone would sit
    // "Working" forever.
    await expect(settled).rejects.toThrow('exited with code 1');
    expect(host.alive).toBe(false);
  });

  it('runTurn_onADeadHarnessRejectsImmediately', async () => {
    transport.end('exited with code 1');

    await expect(
      host.runTurn(
        { requestId: 'r1' },
        { onEvent: (): void => undefined, onRequest: (): Promise<HarnessAnswer> => neverAnswers() },
      ),
    ).rejects.toThrow('not running');
  });

  it('dropsALineThatIsNotJson_andOneThatIsNotAMessage', () => {
    transport.emitRaw('{ not json');
    transport.emitRaw(JSON.stringify({ type: 'exec', command: 'rm -rf /' }));

    // Neither is guessed at. A harness is another program, possibly one Studio downloaded.
    expect(transport.sent).toEqual([]);
  });

  it('audit_isAttributedToTheTurnThatRanTheAction', () => {
    transport.emit({
      type: 'audit',
      requestId: 'r1',
      name: 'Bash',
      detail: 'ls',
      source: 'posture',
    });

    // Protocol 1.1.0 added `requestId` precisely so this is answerable. Before it, an audit record was
    // host-level, because crediting an unattributed action to whichever run was first in a map would
    // have made the log actively misleading rather than merely incomplete.
    expect(audits).toEqual(['r1:Bash']);
  });

  it('audit_withoutARunIsRefusedByTheValidatorRatherThanRecorded', () => {
    transport.emit({ type: 'audit', name: 'Bash', detail: 'ls', source: 'posture' });

    // An executed action that names no turn is exactly what an audit log must not accept.
    expect(audits).toEqual([]);
  });
});

describe('refusalFor', () => {
  it('answersEachQuestionInItsOwnShape', () => {
    // Every question has a "the user did not answer" shape, because a turn can be aborted with a
    // prompt open.
    expect(refusalFor({ kind: 'permission' })).toEqual({ kind: 'permission', granted: false });
    expect(refusalFor({ kind: 'input' })).toEqual({ kind: 'input', answer: null });
    expect(refusalFor({ kind: 'edit-decision' })).toEqual({
      kind: 'edit-decision',
      decision: 'no',
    });
    expect(refusalFor({ kind: 'bridge' })).toEqual({
      kind: 'bridge',
      result: null,
      error: 'refused',
    });
    expect(refusalFor({ kind: 'credential' })).toEqual({ kind: 'credential', apiKey: null });
  });

  it('refusesACredentialAsIndistinguishableFromHavingNone', () => {
    // Deliberately the same shape as an unconfigured connection. A harness that could tell a refusal
    // from an absent key would have a reason to retry against the other, and neither answer means it
    // can authenticate.
    expect(refusalFor({ kind: 'credential' })).toEqual({ kind: 'credential', apiKey: null });
  });

  it('deniesByDefaultWhenItCannotTellWhatWasAsked', () => {
    expect(refusalFor(null)).toEqual({ kind: 'permission', granted: false });
    expect(refusalFor({ kind: 'invented' })).toEqual({ kind: 'permission', granted: false });
  });
});

/**
 * A request handler that never settles, for the tests where the answer is not the point.
 * @returns Returns a promise that never resolves.
 */
function neverAnswers(): Promise<HarnessAnswer> {
  return new Promise<HarnessAnswer>((): void => undefined);
}
