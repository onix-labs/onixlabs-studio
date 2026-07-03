import { TestBed } from '@angular/core/testing';

import { AiChannel } from '@shared/api/ai-channels';
import type { Bridge } from '@shared/api/bridge';
import type {
  AiBridgeReply,
  AiBridgeRequest,
  AiEvent,
  AiPermissionReply,
  AiProviderInfo,
  AiRunRequest,
} from '@shared/api/ai-types';
import { AiRuntime } from './ai-runtime';

/**
 * The providers the stub bridge reports.
 */
const PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude (Agent SDK)',
    available: true,
    detail: 'ok',
    models: [{ id: 'claude-opus-4-8', label: 'Opus 4.8' }],
    defaultModelId: 'claude-opus-4-8',
  },
];

describe('AiRuntime', () => {
  let runCalls: AiRunRequest[];
  let abortCalls: string[];
  let bridgeReplies: AiBridgeReply[];
  let permissionReplies: AiPermissionReply[];
  let fireEvent: (event: AiEvent) => void;
  let fireBridgeRequest: (request: AiBridgeRequest) => void;

  /**
   * Flushes pending microtasks so the asynchronous bridge handler settles.
   * @returns Returns a promise that resolves after the current task queue drains.
   */
  function flush(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  /**
   * Installs a stub transport on `window.bridge` routing the agent run channels: `invoke` records
   * run/abort and answers `list-providers`; `on` captures the event and in-app-capability listeners so
   * the tests can drive them; `send` records the replies.
   */
  function stubBridge(): void {
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (AiChannel.ListProviders as string)) {
          return Promise.resolve(PROVIDERS as T);
        }
        if (channel === (AiChannel.Run as string)) {
          runCalls.push(args[0] as AiRunRequest);
          return Promise.resolve(undefined as T);
        }
        if (channel === (AiChannel.Abort as string)) {
          abortCalls.push(args[0] as string);
          return Promise.resolve(undefined as T);
        }
        return Promise.resolve(undefined as T);
      },
      send: (channel: string, ...args: unknown[]): void => {
        if (channel === (AiChannel.BridgeReply as string)) {
          bridgeReplies.push(args[0] as AiBridgeReply);
        }
        if (channel === (AiChannel.PermissionReply as string)) {
          permissionReplies.push(args[0] as AiPermissionReply);
        }
      },
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (AiChannel.Event as string)) {
          fireEvent = (event: AiEvent): void => listener(event);
        }
        if (channel === (AiChannel.BridgeRequest as string)) {
          fireBridgeRequest = (request: AiBridgeRequest): void => listener(request);
        }
        return (): void => undefined;
      },
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;
  }

  beforeEach(() => {
    runCalls = [];
    abortCalls = [];
    bridgeReplies = [];
    permissionReplies = [];
  });

  afterEach(() => {
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
  });

  it('isAvailable_whenBridgeAbsent_isFalse', () => {
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    expect(runtime.isAvailable).toBe(false);
  });

  it('run_whenCalled_forwardsARequestWithAGeneratedIdAndReturnsIt', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    const requestId: string = runtime.run('claude', 'hello');

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0].requestId).toBe(requestId);
    expect(runCalls[0].providerId).toBe('claude');
    expect(runCalls[0].prompt).toBe('hello');
  });

  it('run_whenOptionsOmitted_appliesSafeDefaults', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    runtime.run('claude', 'hello');

    expect(runCalls[0].workspaceRoot).toBeNull();
    expect(runCalls[0].model).toBe('');
    expect(runCalls[0].permissionPosture).toBe('prompt');
    expect(runCalls[0].tokenCap).toBe(0);
  });

  it('run_whenGivenOptions_forwardsThem', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    runtime.run('claude', 'hello', {
      workspaceRoot: '/work',
      model: 'claude-haiku-4-5',
      permissionPosture: 'auto-all',
      tokenCap: 5000,
    });

    expect(runCalls[0].workspaceRoot).toBe('/work');
    expect(runCalls[0].model).toBe('claude-haiku-4-5');
    expect(runCalls[0].permissionPosture).toBe('auto-all');
    expect(runCalls[0].tokenCap).toBe(5000);
  });

  it('run_whenCalledTwice_generatesDistinctIds', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    expect(runtime.run('claude', 'a')).not.toBe(runtime.run('claude', 'b'));
  });

  it('abort_whenCalled_forwardsTheRequestId', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    runtime.abort('run-1');

    expect(abortCalls).toEqual(['run-1']);
  });

  it('onEvent_whenAnEventArrives_notifiesSubscribers', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);
    const received: AiEvent[] = [];
    runtime.onEvent((event: AiEvent): void => {
      received.push(event);
    });

    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'hi' });

    expect(received).toHaveLength(1);
  });

  it('onEvent_whenUnsubscribed_stopsNotifying', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);
    const received: AiEvent[] = [];
    const dispose: () => void = runtime.onEvent((event: AiEvent): void => {
      received.push(event);
    });

    dispose();
    fireEvent({ requestId: 'run-1', kind: 'text', delta: 'hi' });

    expect(received).toHaveLength(0);
  });

  it('handleBridgeRequest_whenCapabilityRegistered_repliesWithItsResult', async () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);
    runtime.registerCapability('echo', (input: unknown): unknown => input);

    fireBridgeRequest({ requestId: 'b1', capability: 'echo', input: 'value' });
    await flush();

    expect(bridgeReplies).toEqual([{ requestId: 'b1', ok: true, result: 'value' }]);
  });

  it('handleBridgeRequest_whenCapabilityUnknown_repliesNotOk', async () => {
    stubBridge();
    TestBed.inject(AiRuntime);

    fireBridgeRequest({ requestId: 'b2', capability: 'missing', input: null });
    await flush();

    expect(bridgeReplies[0].ok).toBe(false);
  });

  it('handleBridgeRequest_whenHandlerThrows_repliesNotOkWithTheError', async () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);
    runtime.registerCapability('boom', (): unknown => {
      throw new Error('nope');
    });

    fireBridgeRequest({ requestId: 'b3', capability: 'boom', input: null });
    await flush();

    expect(bridgeReplies[0].ok).toBe(false);
    expect(bridgeReplies[0].error).toBe('nope');
  });

  it('respondPermission_whenCalled_forwardsTheReply', () => {
    stubBridge();
    const runtime: AiRuntime = TestBed.inject(AiRuntime);

    runtime.respondPermission('p1', true);

    expect(permissionReplies).toEqual([{ permissionId: 'p1', granted: true }]);
  });
});
