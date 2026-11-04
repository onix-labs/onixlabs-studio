import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientChannel } from '@shared/api/api-client-channels';
import { HttpOutcome, ResolvedHttpRequest } from '@shared/api/api-client-types';
import { ContributionListener, ContributionLogger, InvokeHandler } from '../main-contribution';
import { ApiClientContribution } from './api-client.contribution';
import { TransportRequest, TransportResponse } from './api-client-transport';

/**
 * Builds a transport response with the fields a test cares about.
 */
function answer(values: Partial<TransportResponse> = {}): TransportResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    body: new Uint8Array(),
    sizeBytes: 0,
    truncated: false,
    finalUrl: 'https://api.test/thing',
    redirected: false,
    firstByteMs: 1,
    ...values,
  };
}

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
  let context: FakeContext;
  let transport: (request: TransportRequest) => Promise<TransportResponse>;
  let sent: TransportRequest | undefined;

  /**
   * Sends a request through the registered handler.
   */
  async function send(spec: ResolvedHttpRequest): Promise<HttpOutcome> {
    const handler: InvokeHandler = context.handlers.get(ApiClientChannel.Send)!;
    return (await handler({} as never, spec)) as HttpOutcome;
  }

  beforeEach(() => {
    sent = undefined;
    transport = (): Promise<TransportResponse> => Promise.resolve(answer());
    const contribution: ApiClientContribution = new ApiClientContribution(
      (request: TransportRequest): Promise<TransportResponse> => {
        sent = request;
        return transport(request);
      },
    );
    context = new FakeContext();
    contribution.activate(context);
  });

  it('activate_registersTheSendHandlerAndTheCancelListener', () => {
    expect(context.handlers.has(ApiClientChannel.Send)).toBe(true);
    expect(context.listeners.has(ApiClientChannel.Cancel)).toBe(true);
  });

  it('send_whenTheServerResponds_reportsTheStatusHeadersBodyAndSize', async () => {
    const text: string = '{"ok":true}';
    transport = (): Promise<TransportResponse> =>
      Promise.resolve(
        answer({
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode(text),
          sizeBytes: text.length,
        }),
      );

    const outcome: HttpOutcome = await send(request());

    expect(outcome.kind).toBe('response');
    if (outcome.kind === 'response') {
      expect(outcome.status).toBe(201);
      expect(outcome.headers['content-type']).toBe('application/json');
      expect(outcome.body).toBe(text);
      expect(outcome.sizeBytes).toBe(text.length);
    }
  });

  it('send_whenTheBodyWasCut_saysSo', async () => {
    transport = (): Promise<TransportResponse> => Promise.resolve(answer({ truncated: true }));

    expect(await send(request())).toMatchObject({ kind: 'response', truncated: true });
  });

  it('send_whenTheStatusIsAnError_isStillAResponseRatherThanAFailure', async () => {
    // A 500 is an answer. Only the absence of an answer is a failure — the distinction the user cares
    // about, and one a status code cannot carry.
    transport = (): Promise<TransportResponse> => Promise.resolve(answer({ status: 500 }));

    expect((await send(request())).kind).toBe('response');
  });

  it('send_whenTheTransportFails_reportsAFailureCarryingTheUnderlyingCause', async () => {
    transport = (): Promise<TransportResponse> =>
      Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9'));

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
    transport = (): Promise<TransportResponse> => Promise.reject(aborted);

    const outcome: HttpOutcome = await send(request());

    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.cancelled).toBe(true);
    }
  });

  it('send_forABodylessMethod_dropsTheBodyRatherThanSendingAProtocolError', async () => {
    // A GET with a body is a protocol error, whatever the editor holds, so the engine drops it.
    await send(request({ method: 'GET', body: '{"a":1}' }));

    expect(sent?.url).toBe('https://api.test/thing');
    expect(sent?.body).toBeNull();
  });

  it('send_whenRedirectsAreNotFollowed_asksTheTransportForTheRedirectItself', async () => {
    // Seeing the 302 itself is the point of turning redirects off.
    await send(request({ followRedirects: false }));

    expect(sent?.followRedirects).toBe(false);
  });

  it('send_passesTheSettingsThroughToTheTransport', async () => {
    await send(
      request({
        maxBodyBytes: 8,
        acceptSelfSigned: 'always',
        proxy: { mode: 'custom', address: 'p:1', bypass: '' },
      }),
    );

    expect(sent).toMatchObject({
      maxBodyBytes: 8,
      acceptSelfSigned: 'always',
      proxy: { mode: 'custom', address: 'p:1' },
    });
  });
});
