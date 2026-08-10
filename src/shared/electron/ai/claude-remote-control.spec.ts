import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { inboundText, RemoteControlBridge } from './claude-remote-control';

/**
 * A fake bridge session handle recording the calls the bridge makes.
 */
class FakeHandle {
  public readonly writes: SDKMessage[] = [];
  public readonly states: string[] = [];
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
  public close(): void {
    this.closes += 1;
  }
}

/**
 * Constructs a bridge over a fake handle, bypassing the network `open()` factory.
 * @param handle The fake handle.
 * @returns Returns the bridge.
 */
function bridgeOver(handle: FakeHandle): RemoteControlBridge {
  const ctor: new (handle: unknown, sessionId: string) => RemoteControlBridge =
    RemoteControlBridge as unknown as new (handle: unknown, sessionId: string) => RemoteControlBridge;
  return new ctor(handle, 'cse_test');
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
