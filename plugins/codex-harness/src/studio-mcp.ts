// Studio's own tools, served to Codex as an MCP server on this machine's loopback (#854).
//
// The Claude harness hands its SDK an in-process MCP server. Codex cannot take one: its CLI is a
// separate native process, and it reaches MCP servers by command or by URL. So this harness runs a
// small MCP server over HTTP on 127.0.0.1, gives the CLI its URL, and forwards every call to Studio —
// which runs the tool, applies the user's per-tool policy, raises the permission prompt and audits it.
// ⛔ Execution never happens here, exactly as in the Claude harness.
//
// Written against node:http with no dependency, deliberately. The MCP SDK would pull a web framework
// and a schema library into this plugin's lockfile for four JSON-RPC methods, and Studio already sends
// each tool's input as JSON Schema — which is what MCP's `tools/list` carries — so nothing needs
// converting. Plain JSON responses are a valid Streamable HTTP reply; no event stream is needed.
//
// 🔒 Loopback only, behind a random bearer token the CLI is given through its environment, so another
// process on the machine cannot drive Studio's tools through this port.

import { randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StudioTool } from './protocol';

/**
 * The MCP protocol version answered when a client asks for one this server does not know.
 */
const DEFAULT_PROTOCOL_VERSION: string = '2025-03-26';

/**
 * The largest request body accepted, so a misbehaving client cannot exhaust memory.
 */
const MAX_BODY_BYTES: number = 8 * 1024 * 1024;

/**
 * How this server reaches Studio for the tools and for running one.
 */
export interface StudioToolBridge {
  /**
   * Asks Studio what it offers the turn in flight.
   * @returns Returns the tools.
   */
  describe(): Promise<readonly StudioTool[]>;

  /**
   * Asks Studio to run one of its tools for the turn in flight.
   * @param name The tool.
   * @param input The arguments the model supplied.
   * @returns Returns the result, or why it could not run.
   */
  invoke(name: string, input: unknown): Promise<{ result: string | null; error: string | null }>;
}

/**
 * Describes the running server: where the CLI finds it, and the token it must present.
 */
export interface StudioMcpServer {
  /**
   * Gets the URL of the MCP endpoint.
   */
  readonly url: string;

  /**
   * Gets the bearer token a client must present.
   */
  readonly token: string;

  /**
   * Stops the server.
   */
  close(): void;
}

/**
 * Describes one JSON-RPC message, as much of it as this server reads.
 */
interface RpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

/**
 * Starts the MCP server on a free loopback port.
 * @param bridge How to reach Studio.
 * @returns Returns the running server.
 */
export async function startStudioMcpServer(bridge: StudioToolBridge): Promise<StudioMcpServer> {
  const token: string = randomBytes(32).toString('hex');
  const server: Server = createServer(
    (request: IncomingMessage, response: ServerResponse): void => {
      void handle(request, response, token, bridge);
    },
  );
  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: (): void => {
      server.close();
    },
  };
}

/**
 * Answers one HTTP request.
 * @param request The request.
 * @param response The response.
 * @param token The bearer token a client must present.
 * @param bridge How to reach Studio.
 */
async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  bridge: StudioToolBridge,
): Promise<void> {
  if (request.headers.authorization !== `Bearer ${token}`) {
    reply(response, 401, { error: 'unauthorized' });
    return;
  }
  if (request.method === 'DELETE') {
    // Ending a session: there is no session state to release.
    reply(response, 200, {});
    return;
  }
  if (request.method !== 'POST') {
    // No server-initiated stream is offered, which the transport allows a server to decline this way.
    reply(response, 405, { error: 'method not allowed' });
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    reply(response, 400, rpcError(null, -32700, 'Parse error'));
    return;
  }
  const messages: readonly RpcMessage[] = Array.isArray(body)
    ? (body as readonly RpcMessage[])
    : [body as RpcMessage];
  const answers: unknown[] = [];
  for (const message of messages) {
    const answer: unknown = await answerMessage(message, bridge);
    if (answer !== undefined) {
      answers.push(answer);
    }
  }
  if (answers.length === 0) {
    // Only notifications: accepted, nothing to say.
    response.writeHead(202).end();
    return;
  }
  reply(response, 200, Array.isArray(body) ? answers : answers[0]);
}

/**
 * Answers one JSON-RPC message, or returns undefined for a notification.
 * @param message The message.
 * @param bridge How to reach Studio.
 * @returns Returns the response, or undefined when none is owed.
 */
async function answerMessage(message: RpcMessage, bridge: StudioToolBridge): Promise<unknown> {
  const id: unknown = message.id;
  if (id === undefined || id === null) {
    return undefined;
  }
  const params: Record<string, unknown> =
    typeof message.params === 'object' && message.params !== null
      ? (message.params as Record<string, unknown>)
      : {};
  switch (message.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion:
          typeof params['protocolVersion'] === 'string'
            ? params['protocolVersion']
            : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'studio', version: '1.0.0' },
        instructions:
          "ONIXLabs Studio's own tools: they act on the editor, the workspace and the user's windows, and Studio asks the user before anything that changes something.",
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list': {
      const tools: readonly StudioTool[] = await bridge.describe();
      return rpcResult(id, {
        tools: tools.map((tool: StudioTool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    case 'tools/call': {
      const name: unknown = params['name'];
      if (typeof name !== 'string') {
        return rpcError(id, -32602, 'tools/call needs a tool name.');
      }
      const outcome: { result: string | null; error: string | null } = await bridge.invoke(
        name,
        params['arguments'] ?? {},
      );
      return rpcResult(id, {
        content: [{ type: 'text', text: outcome.error ?? outcome.result ?? '' }],
        isError: outcome.error !== null,
      });
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(message.method)}`);
  }
}

/**
 * Reads a request body, refusing one that is too large.
 * @param request The request.
 * @returns Returns the body as text.
 */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject): void => {
    const chunks: Buffer[] = [];
    let size: number = 0;
    request.on('data', (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', (): void => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * Writes a JSON response.
 * @param response The response.
 * @param status The HTTP status.
 * @param body The body.
 */
function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/**
 * Builds a JSON-RPC result.
 * @param id The request id.
 * @param result The result.
 * @returns Returns the response.
 */
function rpcResult(id: unknown, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Builds a JSON-RPC error.
 * @param id The request id, or null when it could not be read.
 * @param code The error code.
 * @param message The message.
 * @returns Returns the response.
 */
function rpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
