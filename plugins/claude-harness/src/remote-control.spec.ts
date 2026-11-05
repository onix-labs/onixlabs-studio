import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKControlResponse, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RemoteControlBridge } from './remote-control';

/**
 * What a fake bridge handle was told.
 */
interface FakeHandle {
  readonly written: unknown[];
  readonly states: unknown[][];
  readonly requests: { request_id: string; request: Record<string, unknown> }[];
  readonly cancelled: string[];
  readonly metadata: unknown[];
  results: number;
  closes: number;
  failing: boolean;
  write(message: unknown): void;
  sendResult(): void;
  reportState(...args: unknown[]): void;
  reportMetadata(metadata: unknown): void;
  sendControlRequest(request: { request_id: string; request: Record<string, unknown> }): void;
  sendControlCancelRequest(id: string): void;
  close(): void;
}

/**
 * What an attach was given.
 */
interface AttachOptions {
  readonly outboundOnly?: boolean;
  readonly onInboundMessage?: (message: unknown) => void;
  readonly onPermissionResponse?: (response: unknown) => void;
  readonly onClose?: (code?: number) => void;
}

const sdk: {
  created: unknown;
  credentials: unknown;
  attached: AttachOptions | null;
  attachFailure: Error | null;
  handle: FakeHandle | null;
} = { created: 'session-1', credentials: null, attached: null, attachFailure: null, handle: null };

/** The credential store the harness reads, never the machine's: the login is the user's. */
const login: { keychain: string | Error; file: string | Error } = {
  keychain: '',
  file: '',
};

vi.mock('node:child_process', () => {
  const execFileSync: () => string = (): string => {
    if (login.keychain instanceof Error) {
      throw login.keychain;
    }
    return login.keychain;
  };
  return { execFileSync, default: { execFileSync } };
});

vi.mock('node:fs', () => {
  const readFileSync: () => string = (): string => {
    if (login.file instanceof Error) {
      throw login.file;
    }
    return login.file;
  };
  return { readFileSync, default: { readFileSync } };
});

vi.mock('@anthropic-ai/claude-agent-sdk/bridge', () => ({
  createCodeSession: (): Promise<unknown> => Promise.resolve(sdk.created),
  fetchRemoteCredentials: (): Promise<unknown> => Promise.resolve(sdk.credentials),
  isCredentialsFailure: (value: unknown): boolean =>
    (value as { failure?: boolean } | null)?.failure === true,
  isCredentialsRejection: (value: unknown): boolean =>
    (value as { rejection?: boolean } | null)?.rejection === true,
  isCreateSessionFailure: (value: unknown): boolean =>
    (value as { failure?: boolean } | null)?.failure === true,
  attachBridgeSession: (options: AttachOptions): Promise<FakeHandle> => {
    sdk.attached = options;
    if (sdk.attachFailure !== null) {
      return Promise.reject(sdk.attachFailure);
    }
    const handle: FakeHandle = {
      written: [],
      states: [],
      requests: [],
      cancelled: [],
      metadata: [],
      results: 0,
      closes: 0,
      failing: false,
      write(message: unknown): void {
        if (handle.failing) {
          throw new Error('socket closed');
        }
        handle.written.push(message);
      },
      sendResult(): void {
        handle.results += 1;
      },
      reportState(...args: unknown[]): void {
        handle.states.push(args);
      },
      reportMetadata(metadata: unknown): void {
        handle.metadata.push(metadata);
      },
      sendControlRequest(request: { request_id: string; request: Record<string, unknown> }): void {
        if (handle.failing) {
          throw new Error('socket closed');
        }
        handle.requests.push(request);
      },
      sendControlCancelRequest(id: string): void {
        if (handle.failing) {
          throw new Error('socket closed');
        }
        handle.cancelled.push(id);
      },
      close(): void {
        handle.closes += 1;
        if (handle.failing) {
          throw new Error('socket closed');
        }
      },
    };
    sdk.handle = handle;
    return Promise.resolve(handle);
  },
}));

/**
 * Reads a value as an SDK message.
 * @param value The value.
 * @returns Returns it.
 */
function message(value: unknown): SDKMessage {
  return value as SDKMessage;
}

/**
 * Builds a control response.
 * @param requestId The request answered.
 * @param response The answer.
 * @param subtype The response's subtype.
 * @returns Returns the response.
 */
function control(
  requestId: unknown,
  response?: unknown,
  subtype: string = 'success',
): SDKControlResponse {
  return {
    type: 'control_response',
    response: { request_id: requestId, subtype, response },
  } as SDKControlResponse;
}

type RemoteControl = typeof import('./remote-control');
// The SDK's alpha bridge types do not resolve under the lint program, which reads this as `any`.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const remoteControl: RemoteControl = await import('./remote-control');
const Bridge: RemoteControl['RemoteControlBridge'] = remoteControl.RemoteControlBridge;
const inboundText: RemoteControl['inboundText'] = remoteControl.inboundText;
const parseGranted: RemoteControl['parseGranted'] = remoteControl.parseGranted;
const parseQuestionAnswer: RemoteControl['parseQuestionAnswer'] = remoteControl.parseQuestionAnswer;
const resolveControlResponse: RemoteControl['resolveControlResponse'] =
  remoteControl.resolveControlResponse;
type Bridge = RemoteControlBridge;

describe('inboundText', () => {
  it.each<[string, unknown, string | null]>([
    ['aString', { message: { content: 'hi' } }, 'hi'],
    ['anEmptyString', { message: { content: '' } }, null],
    [
      'textBlocks',
      {
        message: {
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      },
      'ab',
    ],
    ['onlyOtherBlocks', { message: { content: [{ type: 'image', source: {} }] } }, null],
    ['nullBlocks', { message: { content: [null, { type: 'text', text: 'x' }] } }, 'x'],
    ['aBlockWithANonStringText', { message: { content: [{ type: 'text', text: 5 }] } }, null],
    ['noContent', { message: {} }, null],
    ['noMessage', {}, null],
    ['aNumericContent', { message: { content: 3 } }, null],
  ])('reads_%s', (_name: string, value: unknown, expected: string | null) => {
    expect(inboundText(message(value))).toBe(expected);
  });
});

describe('parseGranted', () => {
  it.each<[unknown]>([
    [{ behavior: 'allow' }],
    [{ allow: true }],
    [{ granted: true }],
    [{ decision: 'approve' }],
    [{ result: 'allow' }],
  ])('allows_%j', (payload: unknown) => {
    expect(parseGranted(payload)).toBe(true);
  });

  it.each<[unknown]>([
    [null],
    [undefined],
    ['allow'],
    [true],
    [{}],
    [{ behavior: 'deny' }],
    [{ behavior: 'ALLOW' }],
    [{ allow: 'true' }],
    [{ granted: 1 }],
    [{ decision: 'reject' }],
  ])('deniesAnythingElse_%j', (payload: unknown) => {
    expect(parseGranted(payload)).toBe(false);
  });
});

describe('parseQuestionAnswer', () => {
  it('takesTheUpdatedInput_inEitherSpelling', () => {
    expect(parseQuestionAnswer({ updatedInput: { answers: { q: 'a' } } })).toEqual({
      answers: { q: 'a' },
    });
    expect(parseQuestionAnswer({ updated_input: { answers: {} } })).toEqual({ answers: {} });
  });

  it('takesABareAnswerPayload', () => {
    expect(parseQuestionAnswer({ answers: { q: 'a' } })).toEqual({ answers: { q: 'a' } });
    expect(parseQuestionAnswer({ response: 'text' })).toEqual({ response: 'text' });
  });

  it.each<[unknown]>([
    [null],
    ['answers'],
    [{}],
    [{ behavior: 'deny', updatedInput: { answers: {} } }],
    [{ allow: false, answers: {} }],
    [{ updatedInput: 'not an object' }],
  ])('readsADecline_from_%j', (payload: unknown) => {
    expect(parseQuestionAnswer(payload)).toBeNull();
  });
});

describe('resolveControlResponse', () => {
  let permissions: Map<string, (granted: boolean) => void>;
  let questions: Map<string, (answer: Record<string, unknown> | null) => void>;
  let settled: unknown[];

  beforeEach(() => {
    settled = [];
    permissions = new Map<string, (granted: boolean) => void>([
      ['p', (granted: boolean): void => void settled.push(granted)],
    ]);
    questions = new Map<string, (answer: Record<string, unknown> | null) => void>([
      ['q', (answer: Record<string, unknown> | null): void => void settled.push(answer)],
    ]);
  });

  it('settlesAPermissionOnce', () => {
    resolveControlResponse(permissions, questions, control('p', { behavior: 'allow' }));
    resolveControlResponse(permissions, questions, control('p', { behavior: 'allow' }));

    expect(settled).toEqual([true]);
  });

  it('takesAnErrorResponseAsADenial_whateverItCarries', () => {
    resolveControlResponse(permissions, questions, control('p', { behavior: 'allow' }, 'error'));

    expect(settled).toEqual([false]);
  });

  it('settlesAQuestion_andAnErrorResponseAsNoAnswer', () => {
    resolveControlResponse(permissions, questions, control('q', { answers: { a: 1 } }));
    expect(settled).toEqual([{ answers: { a: 1 } }]);

    questions.set('r', (answer: Record<string, unknown> | null): void => void settled.push(answer));
    resolveControlResponse(permissions, questions, control('r', { answers: {} }, 'error'));

    expect(settled[1]).toBeNull();
  });

  it.each<[string, unknown]>([
    ['anUnknownId', control('nobody', { behavior: 'allow' })],
    ['aNonStringId', control(4, { behavior: 'allow' })],
    ['noResponse', { type: 'control_response' }],
  ])('ignores_%s', (_name: string, response: unknown) => {
    resolveControlResponse(permissions, questions, response as SDKControlResponse);

    expect(settled).toEqual([]);
    expect(permissions.size).toBe(1);
  });
});

describe('RemoteControlBridge', () => {
  const OPTIONS: { title: string; cwd: string; model: string; onInbound: () => void } = {
    title: 'Session',
    cwd: '/workspace',
    model: 'claude',
    onInbound: (): void => undefined,
  };

  /**
   * Opens a bridge, expecting it to open.
   * @param mode The mode.
   * @param onInbound Receives what a peer types.
   * @returns Returns the bridge and its handle.
   */
  async function open(
    mode: 'mirror' | 'control',
    onInbound: (text: string) => void = (): void => undefined,
  ): Promise<{ bridge: Bridge; handle: FakeHandle }> {
    const bridge: Bridge | null = await Bridge.open({ ...OPTIONS, mode, onInbound });
    if (bridge === null || sdk.handle === null) {
      throw new Error('The bridge did not open');
    }
    return { bridge, handle: sdk.handle };
  }

  beforeEach(() => {
    const token: string = JSON.stringify({ claudeAiOauth: { accessToken: 'token' } });
    login.keychain = token;
    login.file = token;
    sdk.created = 'session-1';
    sdk.credentials = { worker_jwt: 'jwt', api_base_url: 'https://x', worker_epoch: 1 };
    sdk.attached = null;
    sdk.attachFailure = null;
    sdk.handle = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('open', () => {
    it.each<[string, string]>([
      ['noLogin', ''],
      ['aLoginThatIsNotJson', '{'],
      ['aLoginWithNoToken', '{}'],
      ['aLoginWithAnEmptyToken', '{"claudeAiOauth":{"accessToken":""}}'],
      ['aLoginWithANonStringToken', '{"claudeAiOauth":{"accessToken":5}}'],
    ])('isNull_for_%s', async (_name: string, stored: string) => {
      login.keychain = stored;
      login.file = stored;

      expect(await Bridge.open({ ...OPTIONS, mode: 'mirror' })).toBeNull();
    });

    it('isNull_whenTheStoreCannotBeRead', async () => {
      login.keychain = new Error('The specified item could not be found');
      login.file = new Error('ENOENT');

      expect(await Bridge.open({ ...OPTIONS, mode: 'mirror' })).toBeNull();
    });

    it.each<[string, unknown]>([
      ['aTransientFailure', null],
      ['aRejectedLogin', { rejection: true }],
      ['aClassifiedFailure', { failure: true, reason: 'quota', status: 429 }],
    ])('isNull_when_creatingTheSessionMeets_%s', async (_name: string, created: unknown) => {
      sdk.created = created;

      expect(await Bridge.open({ ...OPTIONS, mode: 'mirror' })).toBeNull();
      expect(sdk.attached).toBeNull();
    });

    it.each<[string, unknown]>([
      ['aTransientFailure', null],
      ['aFailure', { failure: true, reason: 'expired' }],
      ['aRejection', { rejection: true, reason: 'revoked' }],
    ])('isNull_when_mintingCredentialsMeets_%s', async (_name: string, credentials: unknown) => {
      sdk.credentials = credentials;

      expect(await Bridge.open({ ...OPTIONS, mode: 'mirror' })).toBeNull();
      expect(sdk.attached).toBeNull();
    });

    it('isNull_whenAttachingThrows', async () => {
      sdk.attachFailure = new Error('connection refused');

      expect(await Bridge.open({ ...OPTIONS, mode: 'control' })).toBeNull();
    });

    it('reportsTheSessionIdle_withItsWorkingDirectory', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('mirror');

      expect(bridge.sessionId).toBe('session-1');
      expect(handle.metadata).toEqual([{ cwd: '/workspace' }]);
      expect(handle.states).toEqual([['idle']]);
    });
  });

  describe('mirror', () => {
    it('opensNoInboundChannel_andCannotPrompt', async () => {
      const { bridge }: { bridge: Bridge } = await open('mirror');

      expect(sdk.attached?.outboundOnly).toBe(true);
      expect(sdk.attached?.onInboundMessage).toBeUndefined();
      expect(sdk.attached?.onPermissionResponse).toBeUndefined();
      expect(bridge.canPrompt).toBe(false);
    });
  });

  describe('control', () => {
    it('givesAPeersMessageToTheSession_butNotOneWithNoText', async () => {
      const inbound: string[] = [];
      await open('control', (text: string): void => void inbound.push(text));

      sdk.attached?.onInboundMessage?.({ message: { content: 'do it' } });
      sdk.attached?.onInboundMessage?.({ message: { content: [] } });

      expect(inbound).toEqual(['do it']);
    });

    it('canPrompt_untilClosed', async () => {
      const { bridge }: { bridge: Bridge } = await open('control');

      expect(bridge.canPrompt).toBe(true);
      bridge.close();
      expect(bridge.canPrompt).toBe(false);
    });

    it('marksThePeersWait_andResolvesWithItsAnswer', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');

      const { id, granted }: { id: string; granted: Promise<boolean> } = bridge.requestPermission(
        'Bash',
        { command: 'ls' },
        { displayName: 'Shell', description: 'List files', toolUseId: 'tool-1' },
      );
      sdk.attached?.onPermissionResponse?.(control(id, { behavior: 'allow' }));

      expect(await granted).toBe(true);
      expect(handle.requests[0].request).toEqual({
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tool-1',
      });
      expect(handle.states.at(-1)).toEqual([
        'requires_action',
        expect.objectContaining({ request_id: id, action_description: 'List files' }),
      ]);
    });

    it('usesTheRequestId_whenThereIsNoToolUseId', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');

      const { id }: { id: string } = bridge.requestPermission('Bash', {});

      expect(handle.requests[0].request['tool_use_id']).toBe(id);
    });

    it('leavesAPromptItCouldNotForwardUnresolved_soTheLocalPromptDecides', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');
      handle.failing = true;

      const { id, granted }: { id: string; granted: Promise<boolean> } = bridge.requestPermission(
        'Bash',
        {},
      );
      sdk.attached?.onPermissionResponse?.(control(id, { behavior: 'allow' }));
      const raced: unknown = await Promise.race([granted, Promise.resolve('unanswered')]);

      expect(raced).toBe('unanswered');
    });

    it('cancelsAPrompt_once_andIgnoresALateAnswer', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');
      const { id, granted }: { id: string; granted: Promise<boolean> } = bridge.requestPermission(
        'Bash',
        {},
      );

      bridge.cancelPermission(id);
      bridge.cancelPermission(id);
      sdk.attached?.onPermissionResponse?.(control(id, { behavior: 'allow' }));
      const raced: unknown = await Promise.race([granted, Promise.resolve('unanswered')]);

      expect(handle.cancelled).toEqual([id]);
      expect(raced).toBe('unanswered');
    });

    it('sendsNoCancel_afterClosing_orWhenTheChannelFails', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');
      const first: { id: string } = bridge.requestPermission('Bash', {});
      const second: { id: string } = bridge.requestPermission('Bash', {});
      const third: { id: string } = bridge.requestQuestions({ questions: [] });

      handle.failing = true;
      expect((): void => bridge.cancelPermission(first.id)).not.toThrow();
      expect((): void => bridge.cancelQuestion(third.id)).not.toThrow();
      handle.failing = false;
      bridge.close();
      bridge.cancelPermission(second.id);

      expect(handle.cancelled).toEqual([]);
    });

    it('asksAQuestion_onTheSameChannel_underTheBuiltInToolName', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');

      const asked: { id: string; answer: Promise<Record<string, unknown> | null> } =
        bridge.requestQuestions({ questions: [{ question: 'Which?' }] }, 'Which?');
      sdk.attached?.onPermissionResponse?.(control(asked.id, { answers: { Which: 'that' } }));

      expect(await asked.answer).toEqual({ answers: { Which: 'that' } });
      expect(handle.requests[0].request['tool_name']).toBe('AskUserQuestion');
    });

    it('cancelsAQuestion', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');
      const { id }: { id: string } = bridge.requestQuestions({ questions: [] });

      bridge.cancelQuestion(id);
      bridge.cancelQuestion(id);

      expect(handle.cancelled).toEqual([id]);
    });

    it('leavesAQuestionItCouldNotForwardUnresolved', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');
      handle.failing = true;

      const { answer }: { answer: Promise<Record<string, unknown> | null> } =
        bridge.requestQuestions({ questions: [] });
      const raced: unknown = await Promise.race([answer, Promise.resolve('unanswered')]);

      expect(raced).toBe('unanswered');
    });

    it('clearAction_goesBackToRunning_onlyFromWaiting', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');

      bridge.clearAction();
      expect(handle.states).toEqual([['idle']]);

      bridge.requestPermission('Bash', {});
      bridge.clearAction();

      expect(handle.states.at(-1)).toEqual(['running']);
    });
  });

  describe('forward', () => {
    it('reportsATurn_coalescingRepeats', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('mirror');

      bridge.forward(message({ type: 'assistant' }));
      bridge.forward(message({ type: 'assistant' }));
      bridge.forward(message({ type: 'user' }));
      bridge.forward(message({ type: 'result' }));

      expect(handle.written).toHaveLength(4);
      expect(handle.results).toBe(1);
      expect(handle.states).toEqual([['idle'], ['running'], ['idle']]);
    });

    it('survivesTheTransportFailing', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('mirror');
      handle.failing = true;

      expect((): void => bridge.forward(message({ type: 'assistant' }))).not.toThrow();
    });

    it('stopsOnceClosed', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('mirror');

      bridge.close();
      bridge.forward(message({ type: 'assistant' }));

      expect(handle.written).toEqual([]);
    });
  });

  describe('close', () => {
    it('isIdempotent_andSurvivesTheTransportFailing', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('mirror');
      handle.failing = true;

      bridge.close();
      bridge.close();

      expect(handle.closes).toBe(1);
    });

    it('stopsReportingWhatItIsWaitingOn', async () => {
      const { bridge, handle }: { bridge: Bridge; handle: FakeHandle } = await open('control');
      bridge.close();
      const before: number = handle.states.length;

      bridge.requestPermission('Bash', {});

      expect(handle.states).toHaveLength(before);
    });
  });
});
