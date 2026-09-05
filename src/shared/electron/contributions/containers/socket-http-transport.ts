import * as http from 'node:http';
import { logger } from '../../logger';

/**
 * A buffered HTTP response: the status and the full body text.
 */
export interface SocketHttpResponse {
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
 * A handle to an open event stream; closing it tears the underlying request down.
 */
export interface StreamHandle {
  /**
   * Closes the stream.
   */
  close(): void;
}

/**
 * HTTP over a local socket: buffered requests, and line-delimited streams that can be torn down.
 *
 * Named for what it does rather than for who calls it. It was `DockerTransport`, which was a name
 * borrowed from its only caller — nothing here knows the Docker Engine API, or any API: it carries
 * bytes to a Unix domain socket or a Windows named pipe and reads them back (#598).
 *
 * Injected into the engine client so that client's parsing, daemon-absent handling and reconnect logic
 * can be unit-tested against a fake, with no socket and no running daemon.
 */
export interface SocketTransport {
  /**
   * Performs one buffered request, resolving with the status and body, or rejecting on a connection
   * error (for example the daemon being absent).
   * @param method The HTTP method.
   * @param path The request path (including any query string).
   * @returns Returns the buffered response.
   */
  request(method: string, path: string): Promise<SocketHttpResponse>;

  /**
   * Opens a long-lived streaming request, delivering each newline-delimited body line to `onLine` and
   * any connection error (including the stream ending) to `onError`.
   * @param method The HTTP method.
   * @param path The request path.
   * @param onLine Receives each complete line of the response body.
   * @param onError Receives a connection error or the stream ending.
   * @returns Returns a handle that closes the stream.
   */
  openStream(
    method: string,
    path: string,
    onLine: (line: string) => void,
    onError: (error: Error) => void,
  ): StreamHandle;
}

/**
 * The production {@link SocketTransport}: Node's HTTP client pointed at a local socket (a Unix domain
 * socket, or a Windows named pipe) instead of a host and port. Structured data therefore comes off the
 * engine's own socket, with no dependency on a command-line client being present.
 */
export class SocketHttpTransport implements SocketTransport {
  /**
   * Initializes a new instance of the {@link SocketHttpTransport} class.
   * @param socketPath The daemon socket path.
   */
  public constructor(private readonly socketPath: string) {}

  /**
   * Performs one buffered request over the daemon socket.
   * @param method The HTTP method.
   * @param path The request path.
   * @returns Returns the buffered response.
   */
  public request(method: string, path: string): Promise<SocketHttpResponse> {
    logger.trace('SocketTransport', `${method} ${path}`);
    return new Promise<SocketHttpResponse>(
      (resolve: (response: SocketHttpResponse) => void, reject: (error: Error) => void): void => {
        const request: http.ClientRequest = http.request(
          { socketPath: this.socketPath, method, path },
          (response: http.IncomingMessage): void => {
            let body: string = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string): void => {
              body += chunk;
            });
            response.on('end', (): void => resolve({ statusCode: response.statusCode ?? 0, body }));
          },
        );
        request.on('error', reject);
        request.end();
      },
    );
  }

  /**
   * Opens a long-lived streaming request over the daemon socket, splitting the chunked body into
   * newline-delimited lines.
   * @param method The HTTP method.
   * @param path The request path.
   * @param onLine Receives each complete line.
   * @param onError Receives a connection error or the stream ending.
   * @returns Returns a handle that closes the stream.
   */
  public openStream(
    method: string,
    path: string,
    onLine: (line: string) => void,
    onError: (error: Error) => void,
  ): StreamHandle {
    logger.trace('SocketTransport', `Opening event stream ${method} ${path}`);
    let buffer: string = '';
    const request: http.ClientRequest = http.request(
      { socketPath: this.socketPath, method, path },
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
        response.on('error', onError);
        response.on('end', (): void => onError(new Error('docker event stream ended')));
      },
    );
    request.on('error', onError);
    request.end();
    return {
      close: (): void => {
        logger.trace('SocketTransport', 'Closing event stream');
        request.destroy();
      },
    };
  }
}
