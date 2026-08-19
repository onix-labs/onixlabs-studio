import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientChannel } from '@shared/api/api-client-channels';
import { HttpOutcome, ResolvedHttpRequest } from '@shared/api/api-client-types';
import { ContributionListener, ContributionLogger, InvokeHandler } from '../main-contribution';
import { ApiClientContribution } from './api-client.contribution';

/**
 * A stand-in contribution context capturing the handlers the contribution registers.
 */
class FakeContext {
  /**
   * Holds the invoke handlers, keyed by channel.
   */
  public readonly handlers: Map<string, InvokeHandler> = new Map<string, InvokeHandler>();

  /**
   * Holds the fire-and-forget listeners, keyed by channel.
   */
  public readonly listeners: Map<string, ContributionListener> = new Map<
    string,
    ContributionListener
  >();

  /**
   * Records an invoke handler.
   * @param channel The channel.
   * @param handler The handler.
   */
  public handle(channel: string, handler: InvokeHandler): void {
    this.handlers.set(channel, handler);
  }

  /**
   * Records a listener.
   * @param channel The channel.
   * @param listener The listener.
   */
  public on(channel: string, listener: ContributionListener): void {
    this.listeners.set(channel, listener);
  }

  /**
   * Ignores renderer pushes; this contribution makes none.
   */
  public send(): void {
    // Nothing to record: the request engine pushes nothing to the renderer.
  }

  /**
   * Fails on any permission request; this contribution declares none.
   */
  public permission<T>(): T {
    throw new Error('no permissions declared');
  }

  /**
   * Reports no main window.
   * @returns Returns null.
   */
  public mainWindow(): null {
    return null;
  }

  /**
   * Swallows the contribution's logging.
   */
  public readonly log: ContributionLogger = {
    error: (): void => {
      // Swallowed.
    },
    warn: (): void => {
      // Swallowed.
    },
    info: (): void => {
      // Swallowed.
    },
  };
}

/**
 * Builds a resolved request with the fields a test cares about.
 */
function request(values: Partial<ResolvedHttpRequest> = {}): ResolvedHttpRequest {
  return {
    id: 'req-1',
    method: 'GET',
    url: 'https://api.test/thing',
    headers: {},
    body: null,
    timeoutMs: 5_000,
    followRedirects: true,
    ...values,
  };
}

describe('ApiClientContribution', () => {
  let contribution: ApiClientContribution;
  let context: FakeContext;

  /**
   * Sends a request through the registered handler.
   */
  async function send(spec: ResolvedHttpRequest): Promise<HttpOutcome> {
    const handler: InvokeHandler = context.handlers.get(ApiClientChannel.Send)!;
    return (await handler({} as never, spec)) as HttpOutcome;
  }

  beforeEach(() => {
    contribution = new ApiClientContribution();
    context = new FakeContext();
    contribution.activate(context);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('activate_registersTheSendHandlerAndTheCancelListener', () => {
    expect(context.handlers.has(ApiClientChannel.Send)).toBe(true);
    expect(context.listeners.has(ApiClientChannel.Cancel)).toBe(true);
  });

  it('send_whenTheServerResponds_reportsTheStatusHeadersBodyAndSize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (): Promise<Response> =>
          Promise.resolve(
            new Response('{"ok":true}', {
              status: 201,
              statusText: 'Created',
              headers: { 'content-type': 'application/json' },
            }),
          ),
      ),
    );

    const outcome: HttpOutcome = await send(request());

    expect(outcome.kind).toBe('response');
    if (outcome.kind === 'response') {
      expect(outcome.status).toBe(201);
      expect(outcome.headers['content-type']).toBe('application/json');
      expect(outcome.body).toBe('{"ok":true}');
      expect(outcome.sizeBytes).toBe('{"ok":true}'.length);
    }
  });

  it('send_whenTheStatusIsAnError_isStillAResponseRatherThanAFailure', async () => {
    // A 500 is an answer. Only the absence of an answer is a failure — the distinction the user cares
    // about, and one a status code cannot carry.
    vi.stubGlobal(
      'fetch',
      vi.fn((): Promise<Response> => Promise.resolve(new Response('nope', { status: 500 }))),
    );

    expect((await send(request())).kind).toBe('response');
  });

  it('send_whenTheTransportFails_reportsAFailureCarryingTheUnderlyingCause', async () => {
    // Node's fetch reports the useful detail on the cause; the uniformly useless "fetch failed" is
    // what the user would otherwise be shown.
    const error: Error = new Error('fetch failed');
    (error as { cause?: unknown }).cause = new Error('connect ECONNREFUSED 127.0.0.1:9');
    vi.stubGlobal(
      'fetch',
      vi.fn((): Promise<Response> => Promise.reject(error)),
    );

    const outcome: HttpOutcome = await send(request());

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.message).toContain('ECONNREFUSED');
      expect(outcome.cancelled).toBe(false);
    }
  });

  it('send_whenCancelled_reportsAFailureMarkedAsCancelled', async () => {
    const aborted: Error = new Error('The operation was aborted');
    aborted.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi.fn((): Promise<Response> => Promise.reject(aborted)),
    );

    const outcome: HttpOutcome = await send(request());

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.cancelled).toBe(true);
    }
  });

  it('send_forABodylessMethod_dropsTheBodyRatherThanSendingAProtocolError', async () => {
    // A GET with a body is a protocol error, whatever the editor holds, so the engine drops it.
    let sentUrl: string = '';
    let sentInit: RequestInit | undefined = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit): Promise<Response> => {
        sentUrl = url;
        sentInit = init;
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    await send(request({ method: 'GET', body: '{"a":1}' }));

    expect(sentUrl).toBe('https://api.test/thing');
    expect((sentInit as RequestInit | undefined)?.body).toBeNull();
  });

  it('send_whenRedirectsAreNotFollowed_asksTheTransportForTheRedirectItself', async () => {
    // Seeing the 302 itself is the point of turning redirects off.
    let sentInit: RequestInit | undefined = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit): Promise<Response> => {
        sentInit = init;
        return Promise.resolve(new Response('', { status: 302 }));
      }),
    );

    await send(request({ followRedirects: false }));

    expect((sentInit as RequestInit | undefined)?.redirect).toBe('manual');
  });
});
