// A JSON-RPC client for Codex's app-server, spoken over the server's stdio as newline-delimited JSON.
//
// The app-server is what lets this harness put Codex's actions to the user: unlike `codex exec`, which
// runs to completion on its own, the server asks its client before a command runs or a file changes,
// as a request the client answers. Everything here is transport — framing, correlation, the three
// message shapes — so the rest of the harness can speak in methods and parameters.

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/**
 * What the connection tells its owner.
 */
export interface AppServerHandlers {
  /**
   * Receives a notification from the server.
   * @param method The method.
   * @param params The parameters.
   */
  onNotification(method: string, params: unknown): void;

  /**
   * Answers a request from the server. Throwing answers it with an error.
   * @param method The method.
   * @param params The parameters.
   * @returns Returns the result.
   */
  onRequest(method: string, params: unknown): Promise<unknown>;

  /**
   * Learns that the connection ended, with the error that ended it when one did.
   * @param error The error, or null when the server simply closed.
   */
  onClose(error: Error | null): void;
}

/**
 * A live connection to an app-server.
 */
export interface AppServerConnection {
  /**
   * Sends a request and resolves with its result, or rejects with the server's error.
   * @param method The method.
   * @param params The parameters.
   * @returns Returns the result.
   */
  request(method: string, params: unknown): Promise<unknown>;

  /**
   * Ends the connection, failing every request still waiting.
   */
  close(): void;
}

/**
 * The error a request fails with when the server answered it with one.
 */
export class AppServerError extends Error {
  /**
   * Gets the server's error code.
   */
  public readonly code: number;

  /**
   * Gets the server's error data, if any.
   */
  public readonly data: unknown;

  /**
   * Initializes a new instance of the {@link AppServerError} class.
   * @param message The server's message.
   * @param code The server's code.
   * @param data The server's data.
   */
  public constructor(message: string, code: number, data: unknown) {
    super(message);
    this.name = 'AppServerError';
    this.code = code;
    this.data = data;
  }
}

/**
 * The two streams a connection is spoken over.
 */
export interface AppServerStreams {
  /**
   * Gets the stream the server's output arrives on.
   */
  readonly input: Readable;

  /**
   * Gets the stream the server reads from.
   */
  readonly output: Writable;
}

/**
 * Opens a connection over two streams.
 * @param streams The streams.
 * @param handlers What the connection tells its owner.
 * @returns Returns the connection.
 */
export function connectAppServer(
  streams: AppServerStreams,
  handlers: AppServerHandlers,
): AppServerConnection {
  let next: number = 0;
  let closed: boolean = false;
  const pending: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  > = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  const write: (message: Record<string, unknown>) => void = (
    message: Record<string, unknown>,
  ): void => {
    if (!closed) {
      streams.output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    }
  };

  const finish: (error: Error | null) => void = (error: Error | null): void => {
    if (closed) {
      return;
    }
    closed = true;
    for (const waiting of pending.values()) {
      waiting.reject(error ?? new Error('The Codex app-server closed.'));
    }
    pending.clear();
    handlers.onClose(error);
  };

  const receive: (line: string) => void = (line: string): void => {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) {
        return;
      }
      message = parsed as Record<string, unknown>;
    } catch {
      // Not JSON, so not a message; the server writes nothing else to stdout, so ignoring it beats
      // dying over a stray line.
      return;
    }
    const id: unknown = message['id'];
    const method: unknown = message['method'];
    if (typeof method === 'string') {
      if (id === undefined || id === null) {
        handlers.onNotification(method, message['params']);
        return;
      }
      void handlers.onRequest(method, message['params']).then(
        (result: unknown): void => write({ id, result: result ?? null }),
        (error: unknown): void =>
          write({
            id,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      );
      return;
    }
    if (typeof id !== 'number') {
      return;
    }
    const waiting:
      { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined =
      pending.get(id);
    if (waiting === undefined) {
      return;
    }
    pending.delete(id);
    const failure: unknown = message['error'];
    if (typeof failure === 'object' && failure !== null) {
      const record: Record<string, unknown> = failure as Record<string, unknown>;
      waiting.reject(
        new AppServerError(
          typeof record['message'] === 'string' ? record['message'] : 'The request failed.',
          typeof record['code'] === 'number' ? record['code'] : 0,
          record['data'],
        ),
      );
    } else {
      waiting.resolve(message['result']);
    }
  };

  const lines: ReturnType<typeof createInterface> = createInterface({
    input: streams.input,
    crlfDelay: Infinity,
  });
  lines.on('line', receive);
  lines.on('close', (): void => finish(null));
  streams.input.on('error', (error: Error): void => finish(error));

  return {
    request: (method: string, params: unknown): Promise<unknown> => {
      if (closed) {
        return Promise.reject(new Error('The Codex app-server closed.'));
      }
      next += 1;
      const id: number = next;
      return new Promise<unknown>(
        (resolve: (value: unknown) => void, reject: (error: Error) => void): void => {
          pending.set(id, { resolve, reject });
          write({ id, method, params });
        },
      );
    },
    close: (): void => {
      lines.close();
      finish(null);
    },
  };
}

/**
 * A running app-server process and the connection to it.
 */
export interface AppServerProcess {
  /**
   * Gets the connection.
   */
  readonly connection: AppServerConnection;

  /**
   * Stops the server.
   */
  stop(): void;
}

/**
 * Starts an app-server and connects to it over its stdio.
 * @param executable The Codex binary.
 * @param env The environment the server runs with.
 * @param handlers What the connection tells its owner.
 * @param onStderr Receives the server's diagnostic output, line by line.
 * @returns Returns the process.
 */
export function spawnAppServer(
  executable: string,
  env: Readonly<Record<string, string>>,
  handlers: AppServerHandlers,
  onStderr: (line: string) => void,
): AppServerProcess {
  const child: ChildProcess = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env },
  });
  if (child.stderr !== null) {
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', onStderr);
  }
  const connection: AppServerConnection = connectAppServer(
    { input: child.stdout!, output: child.stdin! },
    handlers,
  );
  child.on('error', (error: Error): void => {
    onStderr(`could not start: ${error.message}`);
    connection.close();
  });
  child.on('exit', (): void => connection.close());
  return {
    connection,
    stop: (): void => {
      connection.close();
      child.stdin?.end();
      child.kill();
    },
  };
}
