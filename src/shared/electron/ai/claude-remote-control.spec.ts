import type { SDKControlResponse, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  inboundText,
  parseGranted,
  parseQuestionAnswer,
  RemoteControlBridge,
  resolveControlResponse,
  type RemoteControlAttachMode,
} from './claude-remote-control';

/**
 * A fake bridge session handle recording the calls the bridge makes.
 */
class FakeHandle {
  public readonly writes: SDKMessage[] = [];
  public readonly states: string[] = [];
  public readonly actionDetails: (Record<string, unknown> | undefined)[] = [];
  public readonly controlRequests: unknown[] = [];
  public readonly cancels: string[] = [];
  public results: number = 0;
  public closes: number = 0;

  public write(msg: SDKMessage): void {
    this.writes.push(msg);
  }
  public sendResult(): void {
    this.results += 1;
  }
  public reportState(state: string, details?: Record<string, unknown>): void {
    this.states.push(state);
    if (state === 'requires_action') {
      this.actionDetails.push(details);
    }
  }
  public sendControlRequest(req: unknown): void {
    this.controlRequests.push(req);
  }
  public sendControlCancelRequest(id: string): void {
    this.cancels.push(id);
  }
  public close(): void {
    this.closes += 1;
  }
}

/**
 * Constructs a bridge over a fake handle, bypassing the network `open()` factory.
 * @param handle The fake handle.
 * @param mode The attach mode (defaults to control so the prompt channels are live).
 * @param pending The shared pending-permission map (defaults to a fresh one).
 * @param pendingQuestions The shared pending-question map (defaults to a fresh one).
 * @returns Returns the bridge.
 */
function bridgeOver(
  handle: FakeHandle,
  mode: RemoteControlAttachMode = 'control',
  pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>(),
  pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void> = new Map<
    string,
    (answer: Record<string, unknown> | null) => void
  >(),
): RemoteControlBridge {
  type Ctor = new (
    handle: unknown,
    sessionId: string,
    mode: RemoteControlAttachMode,
    pending: Map<string, (granted: boolean) => void>,
    pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void>,
  ) => RemoteControlBridge;
  const ctor: Ctor = RemoteControlBridge as unknown as Ctor;
  return new ctor(handle, 'cse_test', mode, pending, pendingQuestions);
}

describe('inboundText', () => {
  it('readsAStringContent', () => {
    expect(inboundText({ message: { content: 'Hello?' } } as unknown as SDKMessage)).toBe('Hello?');
  });

  it('joinsTextBlocks_andIgnoresNonText', () => {
    const msg: SDKMessage = {
      message: { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] },
    } as unknown as SDKMessage;
    expect(inboundText(msg)).toBe('ab');
  });

  it('returnsNullForEmptyOrMissingContent', () => {
    expect(inboundText({ message: { content: '' } } as unknown as SDKMessage)).toBeNull();
    expect(inboundText({ message: {} } as unknown as SDKMessage)).toBeNull();
    expect(inboundText({} as unknown as SDKMessage)).toBeNull();
  });
});

describe('RemoteControlBridge.forward', () => {
  it('writesEveryMessage_andReportsRunningThenIdleWithAResult', () => {
    const handle: FakeHandle = new FakeHandle();
    const bridge: RemoteControlBridge = bridgeOver(handle);

    bridge.forward({ type: 'assistant' } as unknown as SDKMessage);
    bridge.forward({ type: 'assistant' } as unknown as SDKMessage);
    bridge.forward({ type: 'result' } as unknown as SDKMessage);

    expect(handle.writes).toHaveLength(3);
    // Running reported once (coalesced), then idle once with a single result.
    expect(handle.states).toEqual(['running', 'idle']);
    expect(handle.results).toBe(1);
  });

  it('stopsForwardingAfterClose', () => {
    const handle: FakeHandle = new FakeHandle();
    const bridge: RemoteControlBridge = bridgeOver(handle);

    bridge.close();
    bridge.forward({ type: 'assistant' } as unknown as SDKMessage);

    expect(handle.closes).toBe(1);
    expect(handle.writes).toHaveLength(0);
  });

  it('isIdempotentOnClose', () => {
    const handle: FakeHandle = new FakeHandle();
    const bridge: RemoteControlBridge = bridgeOver(handle);

    bridge.close();
    bridge.close();

    expect(handle.closes).toBe(1);
  });
});

describe('RemoteControlBridge.canPrompt', () => {
  it('isTrueOnlyForALiveControlSession', () => {
    expect(bridgeOver(new FakeHandle(), 'control').canPrompt).toBe(true);
    expect(bridgeOver(new FakeHandle(), 'mirror').canPrompt).toBe(false);
    const closable: RemoteControlBridge = bridgeOver(new FakeHandle(), 'control');
    closable.close();
    expect(closable.canPrompt).toBe(false);
  });
});

describe('RemoteControlBridge.requestPermission', () => {
  it('forwardsACanUseToolControlRequest_andResolvesWhenThePeerAnswers', async () => {
    const handle: FakeHandle = new FakeHandle();
    const pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control', pending);

    const { id, granted } = bridge.requestPermission(
      'Bash',
      { command: 'ls' },
      { displayName: 'Run command', description: 'ls' },
    );

    expect(handle.controlRequests).toEqual([
      { type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } },
    ]);
    // The session is marked requires_action so claude.ai shows it needs attention (and pushes).
    expect(handle.states).toContain('requires_action');
    expect(handle.actionDetails.at(-1)).toMatchObject({
      tool_name: 'Bash',
      display_tool_name: 'Run command',
      action_description: 'ls',
      request_id: id,
    });
    // The peer answers via the shared pending map (as the attach callback would).
    resolveControlResponse(pending, new Map(), {
      type: 'control_response',
      response: { subtype: 'success', request_id: id, response: { behavior: 'allow' } },
    } as unknown as SDKControlResponse);
    await expect(granted).resolves.toBe(true);
  });

  it('cancelPermission_sendsACancelAndDropsThePending', () => {
    const handle: FakeHandle = new FakeHandle();
    const pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control', pending);

    const { id } = bridge.requestPermission('Bash', { command: 'ls' });
    bridge.cancelPermission(id);

    expect(handle.cancels).toEqual([id]);
    expect(pending.has(id)).toBe(false);
    // A second cancel is a no-op (already dropped).
    bridge.cancelPermission(id);
    expect(handle.cancels).toEqual([id]);
  });
});

describe('RemoteControlBridge.requestQuestions', () => {
  it('forwardsAnAskUserQuestionControlRequest_reportsRequiresAction_andResolvesTheAnswer', async () => {
    const handle: FakeHandle = new FakeHandle();
    const pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void> = new Map<
      string,
      (answer: Record<string, unknown> | null) => void
    >();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control', new Map(), pendingQuestions);

    const input: Record<string, unknown> = {
      questions: [{ question: 'Good morning or good afternoon?', options: [{ label: 'Morning' }] }],
    };
    const { id, answer } = bridge.requestQuestions(input, 'Good morning or good afternoon?');

    expect(handle.controlRequests).toEqual([
      {
        type: 'control_request',
        request_id: id,
        request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input },
      },
    ]);
    // The question is surfaced as the waiting-state detail (visible + pushed on claude.ai).
    expect(handle.states).toContain('requires_action');
    expect(handle.actionDetails.at(-1)).toMatchObject({
      tool_name: 'AskUserQuestion',
      action_description: 'Good morning or good afternoon?',
      request_id: id,
    });
    // The peer answers via the shared pending-question map (as the attach callback would).
    resolveControlResponse(new Map(), pendingQuestions, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: id,
        response: { updatedInput: { answers: { 'Good morning or good afternoon?': 'Morning' } } },
      },
    } as unknown as SDKControlResponse);
    await expect(answer).resolves.toEqual({
      answers: { 'Good morning or good afternoon?': 'Morning' },
    });
  });

  it('cancelQuestion_sendsACancelAndDropsThePending', () => {
    const handle: FakeHandle = new FakeHandle();
    const pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void> = new Map<
      string,
      (answer: Record<string, unknown> | null) => void
    >();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control', new Map(), pendingQuestions);

    const { id } = bridge.requestQuestions({ questions: [] });
    bridge.cancelQuestion(id);

    expect(handle.cancels).toEqual([id]);
    expect(pendingQuestions.has(id)).toBe(false);
  });
});

describe('RemoteControlBridge.clearAction', () => {
  it('returnsAWaitingSessionToRunning_andIsANoOpOtherwise', () => {
    const handle: FakeHandle = new FakeHandle();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control');

    // Not waiting: clearAction does nothing.
    bridge.clearAction();
    expect(handle.states).toEqual([]);

    bridge.requestPermission('Bash', { command: 'ls' });
    expect(handle.states).toEqual(['requires_action']);
    bridge.clearAction();
    expect(handle.states).toEqual(['requires_action', 'running']);
    // Idempotent once cleared.
    bridge.clearAction();
    expect(handle.states).toEqual(['requires_action', 'running']);
  });
});

describe('resolveControlResponse', () => {
  it('resolvesFalseForAnErrorSubtypePermission', async () => {
    const pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>();
    const answer: Promise<boolean> = new Promise<boolean>((resolve) => pending.set('id-1', resolve));
    resolveControlResponse(pending, new Map(), {
      type: 'control_response',
      response: { subtype: 'error', request_id: 'id-1', error: 'boom' },
    } as unknown as SDKControlResponse);
    await expect(answer).resolves.toBe(false);
  });

  it('resolvesNullForAnErrorSubtypeQuestion', async () => {
    const pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void> = new Map<
      string,
      (answer: Record<string, unknown> | null) => void
    >();
    const answer: Promise<Record<string, unknown> | null> = new Promise<
      Record<string, unknown> | null
    >((resolve) => pendingQuestions.set('q-1', resolve));
    resolveControlResponse(new Map(), pendingQuestions, {
      type: 'control_response',
      response: { subtype: 'error', request_id: 'q-1', error: 'boom' },
    } as unknown as SDKControlResponse);
    await expect(answer).resolves.toBeNull();
  });

  it('ignoresAnUnknownRequestId', () => {
    const pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>();
    // Must not throw when no resolver matches in either map.
    resolveControlResponse(pending, new Map(), {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'nope', response: { behavior: 'allow' } },
    } as unknown as SDKControlResponse);
    expect(pending.size).toBe(0);
  });
});

describe('parseQuestionAnswer', () => {
  it('unwrapsTheUpdatedInputAnswerPayload', () => {
    expect(
      parseQuestionAnswer({ behavior: 'allow', updatedInput: { answers: { Q: 'A' } } }),
    ).toEqual({ answers: { Q: 'A' } });
    expect(parseQuestionAnswer({ updated_input: { answers: { Q: 'A' } } })).toEqual({
      answers: { Q: 'A' },
    });
  });

  it('acceptsABareAnswersOrResponsePayload', () => {
    expect(parseQuestionAnswer({ answers: { Q: 'A' } })).toEqual({ answers: { Q: 'A' } });
    expect(parseQuestionAnswer({ response: 'freeform' })).toEqual({ response: 'freeform' });
  });

  it('returnsNullOnDeclineOrNothingUsable', () => {
    expect(parseQuestionAnswer({ behavior: 'deny' })).toBeNull();
    expect(parseQuestionAnswer({ allow: false })).toBeNull();
    expect(parseQuestionAnswer({})).toBeNull();
    expect(parseQuestionAnswer(null)).toBeNull();
  });
});

describe('parseGranted', () => {
  it('acceptsSeveralPlausibleAllowShapes', () => {
    expect(parseGranted({ behavior: 'allow' })).toBe(true);
    expect(parseGranted({ allow: true })).toBe(true);
    expect(parseGranted({ granted: true })).toBe(true);
    expect(parseGranted({ decision: 'approve' })).toBe(true);
    expect(parseGranted({ result: 'allow' })).toBe(true);
  });

  it('treatsAnythingElseAsADenial', () => {
    expect(parseGranted({ behavior: 'deny' })).toBe(false);
    expect(parseGranted({})).toBe(false);
    expect(parseGranted(null)).toBe(false);
    expect(parseGranted('allow')).toBe(false);
  });
});
