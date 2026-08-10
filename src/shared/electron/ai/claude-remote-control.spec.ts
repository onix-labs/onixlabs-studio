import type { SDKControlResponse, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  inboundText,
  parseGranted,
  RemoteControlBridge,
  resolvePermissionResponse,
  type RemoteControlAttachMode,
} from './claude-remote-control';

/**
 * A fake bridge session handle recording the calls the bridge makes.
 */
class FakeHandle {
  public readonly writes: SDKMessage[] = [];
  public readonly states: string[] = [];
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
  public reportState(state: string): void {
    this.states.push(state);
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
 * @param mode The attach mode (defaults to control so the permission channel is live).
 * @param pending The shared pending-permission map (defaults to a fresh one).
 * @returns Returns the bridge.
 */
function bridgeOver(
  handle: FakeHandle,
  mode: RemoteControlAttachMode = 'control',
  pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>(),
): RemoteControlBridge {
  const ctor: new (
    handle: unknown,
    sessionId: string,
    mode: RemoteControlAttachMode,
    pending: Map<string, (granted: boolean) => void>,
  ) => RemoteControlBridge = RemoteControlBridge as unknown as new (
    handle: unknown,
    sessionId: string,
    mode: RemoteControlAttachMode,
    pending: Map<string, (granted: boolean) => void>,
  ) => RemoteControlBridge;
  return new ctor(handle, 'cse_test', mode, pending);
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

    const { id, granted } = bridge.requestPermission('Bash', { command: 'ls' });

    expect(handle.controlRequests).toEqual([
      { type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } },
    ]);
    // The peer answers via the shared pending map (as the attach callback would).
    resolvePermissionResponse(pending, {
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

describe('RemoteControlBridge.requestInput / consumeInbound', () => {
  it('armsRequiresAction_andConsumesTheNextInboundAsTheAnswer', async () => {
    const handle: FakeHandle = new FakeHandle();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control');

    const { answer } = bridge.requestInput();
    expect(handle.states).toEqual(['requires_action']);
    // No question is armed until requestInput; the next inbound is the answer.
    expect(bridge.consumeInbound('blue')).toBe(true);
    await expect(answer).resolves.toBe('blue');
    // Answering returns the session to a running turn.
    expect(handle.states).toEqual(['requires_action', 'running']);
  });

  it('consumeInbound_returnsFalseWhenNoQuestionIsArmed', () => {
    const bridge: RemoteControlBridge = bridgeOver(new FakeHandle(), 'control');
    expect(bridge.consumeInbound('just steering')).toBe(false);
  });

  it('cancel_disarmsTheCapture_soLaterInboundSteersAgain', () => {
    const handle: FakeHandle = new FakeHandle();
    const bridge: RemoteControlBridge = bridgeOver(handle, 'control');

    const { cancel } = bridge.requestInput();
    cancel();
    expect(handle.states).toEqual(['requires_action', 'running']);
    // Disarmed: a later inbound is no longer eaten as an answer.
    expect(bridge.consumeInbound('later')).toBe(false);
  });

  it('consumeInbound_isANoOpAfterClose', () => {
    const bridge: RemoteControlBridge = bridgeOver(new FakeHandle(), 'control');
    bridge.requestInput();
    bridge.close();
    expect(bridge.consumeInbound('answer')).toBe(false);
  });
});

describe('resolvePermissionResponse', () => {
  it('resolvesFalseForAnErrorSubtype', async () => {
    const pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>();
    const answer: Promise<boolean> = new Promise<boolean>((resolve) => pending.set('id-1', resolve));
    resolvePermissionResponse(pending, {
      type: 'control_response',
      response: { subtype: 'error', request_id: 'id-1', error: 'boom' },
    } as unknown as SDKControlResponse);
    await expect(answer).resolves.toBe(false);
  });

  it('ignoresAnUnknownRequestId', () => {
    const pending: Map<string, (granted: boolean) => void> = new Map<string, (granted: boolean) => void>();
    // Must not throw when no resolver matches.
    resolvePermissionResponse(pending, {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'nope', response: { behavior: 'allow' } },
    } as unknown as SDKControlResponse);
    expect(pending.size).toBe(0);
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
