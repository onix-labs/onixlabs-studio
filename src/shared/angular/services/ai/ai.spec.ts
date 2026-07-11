import { TestBed } from '@angular/core/testing';

import { AiChannel } from '@shared/api/ai-channels';
import { Bridge } from '@shared/api/bridge';
import type { AiEvent, AiRunRequest } from '@shared/api/ai-types';
import { Ai } from './ai';

/**
 * A recorded bridge invocation or fire-and-forget send.
 */
interface RecordedCall {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('Ai', () => {
  let invokes: RecordedCall[];
  let sends: RecordedCall[];
  let listeners: Map<string, (...args: unknown[]) => void>;

  /**
   * Installs a stub bridge on the window that records invocations, sends, and subscriptions.
   * @param invokeResult The value every stubbed invoke resolves with.
   */
  function stubBridge(invokeResult: unknown): void {
    invokes = [];
    sends = [];
    listeners = new Map<string, (...args: unknown[]) => void>();
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        invokes.push({ channel, args });
        return Promise.resolve(invokeResult as T);
      },
      send: (channel: string, ...args: unknown[]): void => {
        sends.push({ channel, args });
      },
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        listeners.set(channel, listener);
        return (): void => {
          listeners.delete(channel);
        };
      },
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  }

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('client_whenBridgeAbsent_isUndefined', () => {
    delete (window as unknown as { bridge?: unknown }).bridge;
    const service: Ai = TestBed.inject(Ai);

    expect(service.client).toBeUndefined();
  });

  it('authOperations_whenInvoked_forwardToTheirChannels', async () => {
    stubBridge({ mode: 'api-key', hasKey: true });
    const service: Ai = TestBed.inject(Ai);

    await service.client?.getAuthStatus();
    await service.client?.setApiKey('sk-test');
    await service.client?.clearApiKey();

    expect(invokes.map((call: RecordedCall): string => call.channel)).toEqual([
      AiChannel.AuthStatus,
      AiChannel.SetApiKey,
      AiChannel.ClearApiKey,
    ]);
    expect(invokes[1].args).toEqual(['sk-test']);
  });

  it('run_whenInvoked_forwardsTheRequest', async () => {
    stubBridge(undefined);
    const service: Ai = TestBed.inject(Ai);
    const request: AiRunRequest = {
      requestId: 'run-1',
      providerId: 'claude',
      model: 'claude-sonnet-4-6',
      prompt: 'hello',
      workspaceRoot: null,
      permissionPosture: 'prompt',
      tokenCap: 0,
      owningTabId: null,
    };

    await service.client?.run(request);
    await service.client?.abort('run-1');

    expect(invokes[0]).toEqual({ channel: AiChannel.Run, args: [request] });
    expect(invokes[1]).toEqual({ channel: AiChannel.Abort, args: ['run-1'] });
  });

  it('onEvent_whenTheBridgeEmits_unwrapsThePayloadAndUnsubscribes', () => {
    stubBridge(undefined);
    const service: Ai = TestBed.inject(Ai);
    const received: AiEvent[] = [];

    const unsubscribe: (() => void) | undefined = service.client?.onEvent(
      (event: AiEvent): void => {
        received.push(event);
      },
    );
    const event: AiEvent = { requestId: 'run-1', kind: 'text', delta: 'Hi' };
    listeners.get(AiChannel.Event)?.(event);

    expect(received).toEqual([event]);

    unsubscribe?.();
    expect(listeners.has(AiChannel.Event)).toBe(false);
  });

  it('replies_whenSent_useFireAndForgetChannels', () => {
    stubBridge(undefined);
    const service: Ai = TestBed.inject(Ai);

    service.client?.respondPermission({ permissionId: 'p1', granted: true });
    service.client?.respondBridge({ requestId: 'c1', ok: true, result: null });

    expect(sends[0].channel).toBe(AiChannel.PermissionReply);
    expect(sends[0].args).toEqual([{ permissionId: 'p1', granted: true }]);
    expect(sends[1].channel).toBe(AiChannel.BridgeReply);
  });
});
