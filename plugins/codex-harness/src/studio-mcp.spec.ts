import { afterEach, describe, expect, it } from 'vitest';
import { startStudioMcpServer, type StudioMcpServer } from './studio-mcp';
import type { StudioTool } from './protocol';

const TOOL: StudioTool = {
  name: 'open_file',
  description: 'Opens a file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
};

describe('the Studio tool server Codex is pointed at (#854)', () => {
  let server: StudioMcpServer | null = null;
  const calls: { name: string; input: unknown }[] = [];

  /**
   * Starts a server whose Studio offers one tool and answers every call.
   * @param error The error every call returns, or null for success.
   * @returns Returns the server.
   */
  async function start(error: string | null = null): Promise<StudioMcpServer> {
    calls.length = 0;
    server = await startStudioMcpServer({
      describe: (): Promise<readonly StudioTool[]> => Promise.resolve([TOOL]),
      invoke: (name: string, input: unknown) => {
        calls.push({ name, input });
        return Promise.resolve({ result: error === null ? 'opened' : null, error });
      },
    });
    return server;
  }

  /**
   * Posts a JSON-RPC body to the server.
   * @param body The body.
   * @param token The bearer token, or null to send none.
   * @returns Returns the status and the parsed body.
   */
  async function post(
    body: unknown,
    token: string | null,
  ): Promise<{ status: number; body: unknown }> {
    const response: Response = await fetch(server!.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
    const text: string = await response.text();
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  }

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('listensOnLoopbackOnly', async () => {
    expect((await start()).url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('refusesARequestWithoutTheToken_soNoOtherProcessCanDriveStudiosTools', async () => {
    await start();

    expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)).status).toBe(401);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'wrong')).status).toBe(401);
  });

  it('initializes_echoingTheClientsProtocolVersion_andOfferingTools', async () => {
    const { token } = await start();

    const { body } = await post(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      token,
    );

    expect(body).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    });
  });

  it('listsStudiosTools_withTheirJsonSchemaUnconverted', async () => {
    const { token } = await start();

    const { body } = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, token);

    expect(body).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [TOOL] } });
  });

  it('forwardsACall_toStudio_andReturnsItsResultAsText', async () => {
    const { token } = await start();

    const { body } = await post(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'open_file', arguments: { path: 'a.ts' } },
      },
      token,
    );

    expect(calls).toEqual([{ name: 'open_file', input: { path: 'a.ts' } }]);
    expect(body).toMatchObject({
      result: { content: [{ type: 'text', text: 'opened' }], isError: false },
    });
  });

  it('reportsStudiosRefusal_asAToolError', async () => {
    const { token } = await start('The user declined to run this tool.');

    const { body } = await post(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'open_file' } },
      token,
    );

    expect(body).toMatchObject({
      result: {
        content: [{ type: 'text', text: 'The user declined to run this tool.' }],
        isError: true,
      },
    });
  });

  it('acceptsANotification_withNoBody', async () => {
    const { token } = await start();

    const answer: { status: number; body: unknown } = await post(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      token,
    );

    expect(answer.status).toBe(202);
    expect(answer.body).toBeNull();
  });

  it('answersABatch_asABatch_andAnUnknownMethodWithAnError', async () => {
    const { token } = await start();

    const { body } = await post(
      [
        { jsonrpc: '2.0', id: 5, method: 'ping' },
        { jsonrpc: '2.0', id: 6, method: 'resources/list' },
      ],
      token,
    );

    expect(body).toEqual([
      { jsonrpc: '2.0', id: 5, result: {} },
      {
        jsonrpc: '2.0',
        id: 6,
        error: { code: -32601, message: 'Method not found: resources/list' },
      },
    ]);
  });
});
