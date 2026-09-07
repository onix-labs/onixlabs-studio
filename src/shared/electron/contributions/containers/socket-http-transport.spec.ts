import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocketHttpResponse, StreamHandle, SocketHttpTransport } from './socket-http-transport';

/**
 * Distinguishes the socket file each test creates.
 */
let counter: number = 0;

/**
 * Exercises the real HTTP-over-socket transport against a throwaway HTTP server bound to a Unix domain
 * socket — a genuine fake daemon, no Docker required. Skipped on Windows, whose named-pipe transport is
 * a documented follow-on rather than v0.
 */
describe.skipIf(process.platform === 'win32')('SocketHttpTransport', () => {
  let server: http.Server;
  let socketPath: string;
  let transport: SocketHttpTransport;
  let handler: (request: http.IncomingMessage, response: http.ServerResponse) => void;

  beforeEach(async (): Promise<void> => {
    handler = (_request: http.IncomingMessage, response: http.ServerResponse): void => {
      response.writeHead(404);
      response.end();
    };
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void =>
        handler(request, response),
    );
    counter += 1;
    socketPath = join(tmpdir(), `docker-http-${process.pid}-${counter}.sock`);
    rmSync(socketPath, { force: true });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(socketPath, resolve);
    });
    transport = new SocketHttpTransport(socketPath);
  });

  afterEach(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => resolve());
    });
    rmSync(socketPath, { force: true });
  });

  it('request_returnsTheStatusAndBody', async (): Promise<void> => {
    handler = (_request: http.IncomingMessage, response: http.ServerResponse): void => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ Version: '27.0.0' }));
    };

    const response: SocketHttpResponse = await transport.request('GET', '/version');

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ Version: '27.0.0' });
  });

  it('request_reportsANon2xxStatus', async (): Promise<void> => {
    const response: SocketHttpResponse = await transport.request('GET', '/missing');
    expect(response.statusCode).toBe(404);
  });

  it('openStream_splitsTheChunkedBodyIntoLinesAcrossWrites', async (): Promise<void> => {
    handler = (_request: http.IncomingMessage, response: http.ServerResponse): void => {
      response.writeHead(200);
      response.write('line1\nli');
      setTimeout((): void => {
        response.write('ne2\n');
      }, 10);
    };

    const lines: string[] = [];
    await new Promise<void>((resolve: () => void): void => {
      const handle: StreamHandle = transport.openStream(
        'GET',
        '/events',
        (line: string): void => {
          lines.push(line);
          if (lines.length === 2) {
            handle.close();
            resolve();
          }
        },
        (): void => undefined,
      );
    });

    expect(lines).toEqual(['line1', 'line2']);
  });
});
