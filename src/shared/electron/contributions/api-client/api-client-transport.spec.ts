import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiProxy } from '@shared/api/api-client-types';
import {
  createApiTransport,
  isBypassed,
  isLocalHost,
  proxyFor,
  redirected,
  type ApiTransport,
  type SystemProxyResolver,
  type TransportRequest,
  type TransportResponse,
} from './api-client-transport';

/**
 * Describes what a redirect carries over.
 */
type Hop = Pick<TransportRequest, 'method' | 'url' | 'headers' | 'body'>;

describe('isLocalHost', () => {
  it('isLocalHost_knowsThisMachinesNames', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('app.localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('example.com')).toBe(false);
  });

  it('isLocalHost_isNotFooledByAPublicNameThatStartsLikeAnAddress', () => {
    // Being local turns certificate checks off under the Localhost policy, and skips the proxy.
    expect(isLocalHost('127.evil.example')).toBe(false);
    expect(isLocalHost('127.0.0.1.evil.example')).toBe(false);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('127.255.3.4')).toBe(true);
  });
});

describe('isBypassed', () => {
  it('isBypassed_matchesNamesAndSuffixes', () => {
    expect(isBypassed('a.test', 'a.test, b.test')).toBe(true);
    expect(isBypassed('x.corp.test', '*.corp.test')).toBe(true);
    expect(isBypassed('corp.test', '*.corp.test')).toBe(false);
    expect(isBypassed('a.test', '')).toBe(false);
  });
});

describe('proxyFor', () => {
  const direct: () => Promise<string> = (): Promise<string> => Promise.resolve('DIRECT');

  it('proxyFor_whenNone_goesDirect', async () => {
    expect(
      await proxyFor(
        new URL('https://a.test'),
        { mode: 'none', address: 'p:1', bypass: '' },
        direct,
      ),
    ).toBeNull();
  });

  it('proxyFor_whenCustom_usesItsAddressUnlessBypassed', async () => {
    const proxy: ApiProxy = { mode: 'custom', address: 'http://p:1', bypass: 'b.test' };

    expect(await proxyFor(new URL('https://a.test'), proxy, direct)).toBe('p:1');
    expect(await proxyFor(new URL('https://b.test'), proxy, direct)).toBeNull();
    expect(await proxyFor(new URL('http://localhost:80'), proxy, direct)).toBeNull();
  });

  it('proxyFor_whenSystem_takesTheFirstAnswer', async () => {
    const proxy: ApiProxy = { mode: 'system', address: '', bypass: '' };

    expect(
      await proxyFor(new URL('https://a.test'), proxy, (): Promise<string> =>
        Promise.resolve('PROXY q:8080; DIRECT'),
      ),
    ).toBe('q:8080');
    expect(await proxyFor(new URL('https://a.test'), proxy, direct)).toBeNull();
  });
});

describe('redirected', () => {
  const post: Hop = {
    method: 'POST',
    url: 'https://a.test/x',
    headers: { Authorization: 'secret', 'Content-Type': 'text/plain', Accept: 'a' },
    body: 'b',
  };

  it('redirected_whenA303_becomesAGetWithoutItsBody', () => {
    const next: Hop = redirected(post, 303, 'https://a.test/y');

    expect(next.method).toBe('GET');
    expect(next.body).toBeNull();
    expect(next.headers).toEqual({ Authorization: 'secret', Accept: 'a' });
  });

  it('redirected_whenA307_keepsTheMethodAndBody', () => {
    const next: Hop = redirected(post, 307, 'https://a.test/y');

    expect(next.method).toBe('POST');
    expect(next.body).toBe('b');
  });

  it('redirected_toAnotherOrigin_dropsCredentials', () => {
    expect(redirected(post, 307, 'https://b.test/').headers).not.toHaveProperty('Authorization');
  });
});

describe('createApiTransport against a local fixture', () => {
  /**
   * Answers one fixture request.
   */
  type Handler = (request: IncomingMessage, response: ServerResponse) => void;

  const noProxy: ApiProxy = { mode: 'none', address: '', bypass: '' };
  let server: Server;
  let origin: string;
  let port: number;
  let handler: Handler;
  let connects: string[];
  const sockets: Set<Socket> = new Set<Socket>();
  const system: SystemProxyResolver = (): Promise<string> =>
    Promise.reject(new Error('The fixture never asks the system.'));
  const transport: ApiTransport = createApiTransport(system);

  /**
   * Builds a request to the fixture.
   * @param overrides The fields to set.
   * @returns Returns the request.
   */
  function send(overrides: Partial<TransportRequest> = {}): Promise<TransportResponse> {
    return transport({
      method: 'GET',
      url: `${origin}/`,
      headers: {},
      body: null,
      followRedirects: true,
      maxBodyBytes: 1024,
      acceptSelfSigned: 'never',
      proxy: noProxy,
      signal: new AbortController().signal,
      ...overrides,
    });
  }

  beforeEach(async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.end('ok');
    };
    connects = [];
    server = createServer((request: IncomingMessage, response: ServerResponse): void => {
      handler(request, response);
    });
    server.on('connection', (socket: Socket): void => {
      sockets.add(socket);
    });
    server.on('connect', (request: IncomingMessage, socket: Socket): void => {
      connects.push(request.url ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => resolve());
    });
  });

  it('readsAResponse_withWhatTheServerStated', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.setHeader('content-length', '5');
      response.setHeader('set-cookie', ['a=1', 'b=2']);
      response.end('hello');
    };

    const answer: TransportResponse = await send();

    expect(answer.status).toBe(200);
    expect(new TextDecoder().decode(answer.body)).toBe('hello');
    expect(answer.sizeBytes).toBe(5);
    expect(answer.headers['set-cookie']).toBe('a=1, b=2');
    expect(answer.redirected).toBe(false);
    expect(answer.truncated).toBe(false);
  });

  it('sendsDefaults_unlessTheUserSetThem', async () => {
    const seen: IncomingMessage['headers'][] = [];
    handler = (request: IncomingMessage, response: ServerResponse): void => {
      seen.push(request.headers);
      response.end();
    };

    await send({ headers: { Accept: 'text/plain' } });

    expect(seen[0].accept).toBe('text/plain');
    expect(seen[0]['user-agent']).toBe('ONIXLabs Studio');
  });

  it('postsItsBody', async () => {
    let received: string = '';
    handler = (request: IncomingMessage, response: ServerResponse): void => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string): void => {
        received += chunk;
      });
      request.on('end', (): void => {
        response.end();
      });
    };

    await send({ method: 'POST', body: '{"a":1}' });

    expect(received).toBe('{"a":1}');
  });

  it('decompressesAGzippedBody', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.setHeader('content-encoding', 'gzip');
      response.end(gzipSync('compressed'));
    };

    expect(new TextDecoder().decode((await send()).body)).toBe('compressed');
  });

  it('aBodyThatIsNotWhatItClaims_rejects', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.setHeader('content-encoding', 'gzip');
      response.end('this is not gzip');
    };

    await expect(send()).rejects.toThrow();
  });

  it('aConnectionLostInAPlainBody_rejects', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.setHeader('content-length', '100000');
      response.write('part', (): void => {
        response.destroy();
      });
    };

    await expect(send()).rejects.toThrow();
  });

  it('cutsALongBodyAtTheLimit', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.end('x'.repeat(5000));
    };

    const answer: TransportResponse = await send({ maxBodyBytes: 100 });

    expect(answer.body).toHaveLength(100);
    expect(answer.truncated).toBe(true);
  });

  it('aBodyOfExactlyTheLimit_isNotCut', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.end('x'.repeat(100));
    };

    const answer: TransportResponse = await send({ maxBodyBytes: 100 });

    expect(answer.body).toHaveLength(100);
    expect(answer.truncated).toBe(false);
  });

  it('aCompressedBomb_isCutAtTheLimit', async () => {
    handler = (_request: IncomingMessage, response: ServerResponse): void => {
      response.setHeader('content-encoding', 'gzip');
      response.end(gzipSync(Buffer.alloc(32 * 1024 * 1024)));
    };

    const answer: TransportResponse = await send({ maxBodyBytes: 100 });

    expect(answer.body).toHaveLength(100);
    expect(answer.truncated).toBe(true);
  });

  describe('redirects', () => {
    it('followsThem_andReportsWhereItLanded', async () => {
      handler = (request: IncomingMessage, response: ServerResponse): void => {
        if (request.url === '/') {
          response.statusCode = 302;
          response.setHeader('location', '/final');
          response.end();
          return;
        }
        response.end('landed');
      };

      const answer: TransportResponse = await send();

      expect(answer.finalUrl).toBe(`${origin}/final`);
      expect(answer.redirected).toBe(true);
    });

    it('reportsThem_whenToldNotToFollow', async () => {
      handler = (_request: IncomingMessage, response: ServerResponse): void => {
        response.statusCode = 302;
        response.setHeader('location', '/final');
        response.end();
      };

      const answer: TransportResponse = await send({ followRedirects: false });

      expect(answer.status).toBe(302);
      expect(answer.redirected).toBe(false);
    });

    it('stopsAtALoop', async () => {
      let hops: number = 0;
      handler = (_request: IncomingMessage, response: ServerResponse): void => {
        hops += 1;
        response.statusCode = 302;
        response.setHeader('location', '/again');
        response.end();
      };

      await expect(send()).rejects.toThrow('Stopped after 20 redirects');
      expect(hops).toBe(21);
    });

    it('refusesToLeaveHttp', async () => {
      // A server must not be able to send the request anywhere but another web address. Aimed at the
      // fixture's own port, so a regression lands here and nowhere else on this machine.
      let hops: number = 0;
      handler = (_request: IncomingMessage, response: ServerResponse): void => {
        hops += 1;
        response.statusCode = 302;
        response.setHeader('location', `ftp://127.0.0.1:${port}/etc/passwd`);
        response.end();
      };

      await expect(send()).rejects.toThrow('ftp:');
      expect(hops).toBe(1);
    });
  });

  describe('abandoning a send', () => {
    it('anAbortWhileWaiting_rejectsWithItsReason', async () => {
      const controller: AbortController = new AbortController();
      handler = (): void => {
        controller.abort(new Error('Timed out'));
      };

      await expect(send({ signal: controller.signal })).rejects.toThrow('Timed out');
    });

    it('anAbortMidBody_rejectsWithItsReason', async () => {
      const controller: AbortController = new AbortController();
      handler = (_request: IncomingMessage, response: ServerResponse): void => {
        response.write('part', (): void => {
          setTimeout((): void => {
            controller.abort(new Error('Timed out'));
          }, 10);
        });
      };

      await expect(send({ signal: controller.signal })).rejects.toThrow('Timed out');
    });
  });

  describe('proxies', () => {
    const through: () => ApiProxy = (): ApiProxy => ({
      mode: 'custom',
      address: `127.0.0.1:${port}`,
      bypass: '',
    });

    it('sendsPlainHttpToTheProxy_withTheFullAddress', async () => {
      const seen: { url?: string; host?: string }[] = [];
      handler = (request: IncomingMessage, response: ServerResponse): void => {
        seen.push({ url: request.url, host: request.headers.host });
        response.end();
      };

      await send({ url: 'http://api.invalid/path?q=1', proxy: through() });

      expect(seen).toEqual([{ url: 'http://api.invalid/path?q=1', host: 'api.invalid' }]);
    });

    it('asksTheProxyForATunnel_andReportsARefusal', async () => {
      await expect(send({ url: 'https://api.invalid/', proxy: through() })).rejects.toThrow(
        'refused the tunnel: 403',
      );
      expect(connects).toEqual(['api.invalid:443']);
    });
  });
});
