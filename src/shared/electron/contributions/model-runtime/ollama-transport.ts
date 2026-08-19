import * as http from 'node:http';
import * as https from 'node:https';
import { logger } from '../../logger';

/**
 * A buffered response from an Ollama server: the HTTP status and the full body text.
 */
export interface OllamaResponse {
  /**
   * The HTTP status code (0 when none was received).
   */
  readonly statusCode: number;

  /**
   * The full response body as text.
   */
  readonly body: string;
}

/**
 * The transport the {@link import('./ollama-runtime').OllamaRuntime} speaks Ollama's native REST API
 * over. Injected so the runtime's mapping and server-absent handling can be unit-tested against a fake
 * without a running server.
 *
 * Unlike the Docker transport, this speaks HTTP over TCP rather than over a local socket: Ollama
 * listens on a host and port (11434 by default), which is also why the manager can, in principle,
 * drive a remote server.
 */
export interface OllamaTransport {
  /**
   * Performs one buffered request, resolving with the status and body, or rejecting on a connection
   * error (for example the server not running).
   * @param method The HTTP method.
   * @param path The request path (including any query string).
   * @param body The JSON body to send, or undefined for a bodyless request.
   * @returns Returns the buffered response.
   */
  request(method: string, path: string, body?: unknown): Promise<OllamaResponse>;

  /**
   * Performs a streaming request, delivering each newline-delimited body line to `onLine` as it
   * arrives. Ollama streams long operations (notably `/api/pull`) as newline-delimited JSON, one
   * object per progress update, so the caller sees progress rather than waiting for a single reply.
   * @param method The HTTP method.
   * @param path The request path.
   * @param body The JSON body to send, or undefined for a bodyless request.
   * @param onLine Receives each complete line of the response body.
   * @param signal Aborts the request when signalled, tearing the connection down.
   * @returns Returns a promise that resolves when the stream ends, or rejects on a connection error
   * or an abort.
   */
  stream(
    method: string,
    path: string,
    body: unknown,
    onLine: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

/**
 * How long, in milliseconds, a request waits before being treated as a connection failure. Kept short
 * because every call sits behind a view that must stay responsive when the server is absent — the
 * common case this whole feature exists to fix.
 */
const REQUEST_TIMEOUT_MS: number = 10_000;

/**
 * The production {@link OllamaTransport}: JSON over HTTP to the server's origin, so structured data
 * comes straight from the native API with no dependency on the `ollama` CLI.
 */
export class HttpOllamaTransport implements OllamaTransport {
  /**
   * The parsed server origin the requests are issued against.
   */
  private readonly origin: URL;

  /**
   * Initializes a new instance of the {@link HttpOllamaTransport} class.
   * @param origin The server origin (for example `http://127.0.0.1:11434`).
   */
  public constructor(origin: string) {
    this.origin = new URL(origin);
  }

  /**
   * Performs one buffered request against the server.
   * @param method The HTTP method.
   * @param path The request path.
   * @param body The JSON body to send, or undefined for a bodyless request.
   * @returns Returns the buffered response.
   */
  public request(method: string, path: string, body?: unknown): Promise<OllamaResponse> {
    logger.trace('OllamaTransport', `${method} ${path}`);
    const payload: string | null = body === undefined ? null : JSON.stringify(body);
    const client: typeof http | typeof https = this.origin.protocol === 'https:' ? https : http;

    return new Promise<OllamaResponse>(
      (resolve: (response: OllamaResponse) => void, reject: (error: Error) => void): void => {
        const request: http.ClientRequest = client.request(
          {
            protocol: this.origin.protocol,
            hostname: this.origin.hostname,
            port: this.origin.port,
            method,
            path,
            headers:
              payload === null
                ? {}
                : {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                  },
          },
          (response: http.IncomingMessage): void => {
            let text: string = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string): void => {
              text += chunk;
            });
            response.on('end', (): void =>
              resolve({ statusCode: response.statusCode ?? 0, body: text }),
            );
          },
        );

        request.setTimeout(REQUEST_TIMEOUT_MS, (): void => {
          request.destroy(new Error('ollama request timed out'));
        });
        request.on('error', reject);
        if (payload !== null) {
          request.write(payload);
        }
        request.end();
      },
    );
  }

  /**
   * Performs a streaming request, splitting the body into newline-delimited lines as they arrive.
   * Deliberately carries no timeout: a model pull legitimately runs for many minutes, and the caller
   * bounds it with an abort signal instead.
   * @param method The HTTP method.
   * @param path The request path.
   * @param body The JSON body to send, or undefined for a bodyless request.
   * @param onLine Receives each complete line.
   * @param signal Aborts the request when signalled.
   * @returns Returns a promise that resolves when the stream ends.
   */
  public stream(
    method: string,
    path: string,
    body: unknown,
    onLine: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    logger.trace('OllamaTransport', `stream ${method} ${path}`);
    const payload: string | null = body === undefined ? null : JSON.stringify(body);
    const client: typeof http | typeof https = this.origin.protocol === 'https:' ? https : http;

    return new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
      if (signal?.aborted === true) {
        reject(new Error('aborted'));
        return;
      }

      let buffer: string = '';
      const request: http.ClientRequest = client.request(
        {
          protocol: this.origin.protocol,
          hostname: this.origin.hostname,
          port: this.origin.port,
          method,
          path,
          headers:
            payload === null
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(payload),
                },
        },
        (response: http.IncomingMessage): void => {
          response.setEncoding('utf8');
          response.on('data', (chunk: string): void => {
            buffer += chunk;
            let newline: number = buffer.indexOf('\n');
            while (newline >= 0) {
              const line: string = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (line.length > 0) {
                onLine(line);
              }
              newline = buffer.indexOf('\n');
            }
          });
          response.on('error', reject);
          response.on('end', (): void => {
            // A final line without its trailing newline is still a complete update.
            const tail: string = buffer.trim();
            if (tail.length > 0) {
              onLine(tail);
            }
            resolve();
          });
        },
      );

      const onAbort: () => void = (): void => {
        request.destroy(new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      request.on('close', (): void => signal?.removeEventListener('abort', onAbort));

      request.on('error', reject);
      if (payload !== null) {
        request.write(payload);
      }
      request.end();
    });
  }
}
