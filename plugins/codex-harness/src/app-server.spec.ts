import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppServerError, connectAppServer, type AppServerConnection } from './app-server';

/**
 * A fake server end of the connection: what it received, and a way to write to the client.
 */
interface FakeServer {
  readonly received: Record<string, unknown>[];
  readonly connection: AppServerConnection;
  readonly notifications: { method: string; params: unknown }[];
  readonly requests: { method: string; params: unknown }[];
  readonly closes: (Error | null)[];
  send(message: Record<string, unknown>): void;
  end(): void;
  flush(): Promise<void>;
}

/**
 * Wires a client to a fake server over two pass-through streams.
 * @param answer How the client answers the server's requests.
 * @returns Returns the fake server.
 */
function fakeServer(
  answer: (method: string, params: unknown) => Promise<unknown> = (): Promise<unknown> =>
    Promise.resolve({ ok: true }),
): FakeServer {
  const toClient: PassThrough = new PassThrough();
  const toServer: PassThrough = new PassThrough();
  const received: Record<string, unknown>[] = [];
  let buffer: string = '';
  toServer.on('data', (chunk: Buffer): void => {
    buffer += chunk.toString('utf8');
    let newline: number = buffer.indexOf('\n');
    while (newline >= 0) {
      received.push(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  });
  const server: FakeServer = {
    received,
    notifications: [],
    requests: [],
    closes: [],
    connection: connectAppServer(
      { input: toClient, output: toServer },
      {
        onNotification: (method: string, params: unknown): void => {
          server.notifications.push({ method, params });
        },
        onRequest: (method: string, params: unknown): Promise<unknown> => {
          server.requests.push({ method, params });
          return answer(method, params);
        },
        onClose: (error: Error | null): void => {
          server.closes.push(error);
        },
      },
    ),
    send: (message: Record<string, unknown>): void => {
      toClient.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    },
    end: (): void => {
      toClient.end();
    },
    flush: (): Promise<void> =>
      new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      }),
  };
  return server;
}

describe('the app-server connection', () => {
  it('request_correlatesTheAnswerByIdAndResolvesItsResult', async () => {
    const server: FakeServer = fakeServer();
    const first: Promise<unknown> = server.connection.request('thread/start', { cwd: '/ws' });
    const second: Promise<unknown> = server.connection.request('model/list', {});
    await server.flush();

    expect(server.received).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'thread/start', params: { cwd: '/ws' } },
      { jsonrpc: '2.0', id: 2, method: 'model/list', params: {} },
    ]);
    // Answered out of order: each lands on its own request.
    server.send({ id: 2, result: { data: [] } });
    server.send({ id: 1, result: { thread: { id: 't1' } } });

    expect(await second).toEqual({ data: [] });
    expect(await first).toEqual({ thread: { id: 't1' } });
  });

  it('request_rejectsWithTheServersError', async () => {
    const server: FakeServer = fakeServer();
    const asked: Promise<unknown> = server.connection.request('turn/start', {});
    await server.flush();
    server.send({
      id: 1,
      error: { code: -32602, message: 'bad params', data: { field: 'input' } },
    });

    await expect(asked).rejects.toMatchObject({
      name: 'AppServerError',
      message: 'bad params',
      code: -32602,
      data: { field: 'input' },
    });
    expect(AppServerError.name).toBe('AppServerError');
  });

  it('notifications_reachTheHandler_andStrayLinesAreIgnored', async () => {
    const server: FakeServer = fakeServer();
    server.send({ method: 'item/agentMessage/delta', params: { delta: 'hi' } });
    server.send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    await server.flush();

    expect(server.notifications).toEqual([
      { method: 'item/agentMessage/delta', params: { delta: 'hi' } },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]);
  });

  it('serverRequests_areAnsweredWithTheHandlersResult_orItsError', async () => {
    const server: FakeServer = fakeServer((method: string): Promise<unknown> =>
      method === 'item/commandExecution/requestApproval'
        ? Promise.resolve({ decision: 'accept' })
        : Promise.reject(new Error('not offered')),
    );
    server.send({
      id: 'req-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'ls' },
    });
    server.send({ id: 'req-2', method: 'mcpServer/elicitation/request', params: {} });
    await server.flush();

    expect(server.requests.map((request) => request.method)).toEqual([
      'item/commandExecution/requestApproval',
      'mcpServer/elicitation/request',
    ]);
    expect(server.received).toEqual([
      { jsonrpc: '2.0', id: 'req-1', result: { decision: 'accept' } },
      { jsonrpc: '2.0', id: 'req-2', error: { code: -32000, message: 'not offered' } },
    ]);
  });

  it('close_failsEveryWaitingRequest_andReportsOnce', async () => {
    const server: FakeServer = fakeServer();
    const waiting: Promise<unknown> = server.connection.request('turn/start', {});
    // Expected before the close lands, so the rejection is handled the moment it happens.
    const failed: Promise<void> = expect(waiting).rejects.toThrow('The Codex app-server closed.');
    await server.flush();

    server.end();
    await server.flush();

    await failed;
    expect(server.closes).toEqual([null]);
    await expect(server.connection.request('x', {})).rejects.toThrow('closed');
    server.connection.close();
    expect(server.closes).toHaveLength(1);
  });
});
