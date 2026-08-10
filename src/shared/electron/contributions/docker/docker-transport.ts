import * as http from 'node:http';
import { logger } from '../../logger';

/**
 * A buffered response from the Docker Engine: the HTTP status and the full body text.
 */
export interface DockerResponse {
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
export interface DockerStreamHandle {
  /**
   * Closes the stream.
   */
  close(): void;
}

/**
 * The transport the {@link import('./docker-engine').DockerEngine} speaks the Engine API over. Injected
 * so the engine's parsing, daemon-absent handling, and reconnect logic can be unit-tested against a
 * fake without a running daemon.
 */
export interface DockerTransport {
  /**
   * Performs one buffered request, resolving with the status and body, or rejecting on a connection
   * error (for example the daemon being absent).
   * @param method The HTTP method.
   * @param path The request path (including any query string).
   * @returns Returns the buffered response.
   */
  request(method: string, path: string): Promise<DockerResponse>;

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
  ): DockerStreamHandle;
}

/**
 * The production {@link DockerTransport}: HTTP over the Docker daemon's local socket (a Unix domain
 * socket, or a Windows named pipe), so structured data comes straight from the Engine API with no
 * dependency on the `docker` CLI.
 */
export class HttpDockerTransport implements DockerTransport {
  /**
   * Initializes a new instance of the {@link HttpDockerTransport} class.
   * @param socketPath The daemon socket path.
   */
  public constructor(private readonly socketPath: string) {}

  /**
   * Performs one buffered request over the daemon socket.
   * @param method The HTTP method.
   * @param path The request path.
   * @returns Returns the buffered response.
   */
  public request(method: string, path: string): Promise<DockerResponse> {
    logger.trace('DockerTransport', `${method} ${path}`);
    return new Promise<DockerResponse>(
      (resolve: (response: DockerResponse) => void, reject: (error: Error) => void): void => {
        const request: http.ClientRequest = http.request(
          { socketPath: this.socketPath, method, path },
          (response: http.IncomingMessage): void => {
            let body: string = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string): void => {
              body += chunk;
            });
            response.on('end', (): void =>
              resolve({ statusCode: response.statusCode ?? 0, body }),
            );
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
  ): DockerStreamHandle {
    logger.trace('DockerTransport', `Opening event stream ${method} ${path}`);
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
        logger.trace('DockerTransport', 'Closing event stream');
        request.destroy();
      },
    };
  }
}
