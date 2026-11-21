import * as fs from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isServedChange, LiveSite, LOOPBACK } from './live-site';
import { CLIENT_PATH, EVENTS_PATH } from './reload-client';

/**
 * A response read whole.
 */
interface Answer {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/**
 * A watcher the spec drives by hand, standing in for the platform's.
 */
class HandWatcher extends EventEmitter {
  public closed: boolean = false;

  public close(): void {
    this.closed = true;
  }
}

/**
 * Asks a site for a path exactly as written — no normalising of `..` — as a hostile client would.
 * @param port The site's port.
 * @param target The request target.
 * @param options The method and Host header to send.
 * @returns Returns the response.
 */
function ask(
  port: number,
  target: string,
  options: { readonly method?: string; readonly host?: string; readonly fetchSite?: string } = {},
): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const request: http.ClientRequest = http.request(
      {
        host: LOOPBACK,
        port,
        path: target,
        method: options.method ?? 'GET',
        headers: {
          Host: options.host ?? `${LOOPBACK}:${port}`,
          ...(options.fetchSite === undefined ? {} : { 'Sec-Fetch-Site': options.fetchSite }),
        },
      },
      (response: http.IncomingMessage) => {
        let body: string = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * Opens a page's event stream and collects its messages.
 * @param port The site's port.
 * @returns Returns the messages so far, and the request to close it with.
 */
async function listen(
  port: number,
): Promise<{ readonly messages: string[]; readonly request: http.ClientRequest }> {
  const messages: string[] = [];
  const request: http.ClientRequest = http.request({
    host: LOOPBACK,
    port,
    path: EVENTS_PATH,
    headers: { Host: `localhost:${port}` },
  });
  await new Promise<void>((resolve) => {
    request.on('response', (response: http.IncomingMessage) => {
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            messages.push(line.slice('data: '.length));
          }
        }
        resolve();
      });
    });
    request.end();
  });
  return { messages, request };
}

/**
 * Waits for a condition.
 * @param condition The condition.
 */
async function until(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

describe('LiveSite (#1062)', () => {
  let scratch: string = '';
  let root: string = '';
  let site: LiveSite;
  let watcher: HandWatcher;
  let onChange: (relative: string) => void = () => undefined;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-server-site-')));
    root = path.join(scratch, 'site');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(scratch, 'secret'));
    fs.writeFileSync(path.join(root, 'index.html'), '<html><body><h1>Home</h1></body></html>');
    fs.writeFileSync(path.join(root, 'site.css'), 'h1 { color: red; }');
    fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(root, '.env'), 'TOKEN=1');
    fs.writeFileSync(path.join(scratch, 'secret', 'passwd'), 'root');
    fs.symlinkSync(path.join(scratch, 'secret'), path.join(root, 'out'));
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(async () => {
    watcher = new HandWatcher();
    site = new LiveSite(root, (_root: string, callback: (relative: string) => void) => {
      onChange = callback;
      return watcher as unknown as FSWatcher;
    });
    await site.listen(0);
  });

  afterEach(async () => {
    await site.close();
  });

  it('serves_thePage_withTheReloadScript', async () => {
    const answer: Answer = await ask(site.port, '/');

    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(answer.headers['x-content-type-options']).toBe('nosniff');
    expect(answer.body).toContain(`<script src="${CLIENT_PATH}"></script>`);
  });

  it('serves_files_withTheirContentTypes', async () => {
    const css: Answer = await ask(site.port, '/site.css');
    const png: Answer = await ask(site.port, '/logo.png');

    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toBe('h1 { color: red; }');
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-length']).toBe('4');
  });

  it('serves_theReloadScript', async () => {
    const answer: Answer = await ask(site.port, CLIENT_PATH);

    expect(answer.status).toBe(200);
    expect(answer.body).toContain('EventSource');
  });

  it.each<[string, number]>([
    ['/../secret/passwd', 403],
    ['/%2e%2e/secret/passwd', 403],
    ['/out/passwd', 403],
    ['/.env', 404],
    ['/missing.html', 404],
  ])('refuses %s with %i', async (target: string, status: number) => {
    const answer: Answer = await ask(site.port, target);

    expect(answer.status).toBe(status);
    expect(answer.body).not.toContain('root');
    expect(answer.body).not.toContain('TOKEN');
  });

  it('redirects_aFolder_toItsSlash', async () => {
    const answer: Answer = await ask(site.port, '/docs');

    expect(answer.status).toBe(301);
    expect(answer.headers.location).toBe('/docs/');
  });

  it('refuses_aRequest_addressedToAnotherHostName', async () => {
    const answer: Answer = await ask(site.port, '/', { host: `rebound.example:${site.port}` });

    expect(answer.status).toBe(403);
  });

  it('refuses_aRequestFromAnotherSite', async () => {
    const answer: Answer = await ask(site.port, '/site.css', { fetchSite: 'cross-site' });

    expect(answer.status).toBe(403);
    expect(answer.body).not.toContain('color');
  });

  it.each<string>(['same-origin', 'same-site', 'none'])(
    'serves_aRequestWhoseFetchSiteIs %s',
    async (fetchSite: string) => {
      expect((await ask(site.port, '/site.css', { fetchSite })).status).toBe(200);
    },
  );

  it('answers_onlyGetAndHead', async () => {
    const post: Answer = await ask(site.port, '/', { method: 'POST' });
    const head: Answer = await ask(site.port, '/site.css', { method: 'HEAD' });

    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('listens_onTheLoopbackAddressOnly', () => {
    const address: string | net.AddressInfo | null = (
      site as unknown as { server: http.Server }
    ).server.address();

    expect(typeof address === 'object' && address?.address).toBe(LOOPBACK);
  });

  it('tells_openPages_toRestyle_whenOnlyAStylesheetChanged', async () => {
    const stream: Awaited<ReturnType<typeof listen>> = await listen(site.port);

    onChange('site.css');
    await until(() => stream.messages.length > 0);
    stream.request.destroy();

    expect(JSON.parse(stream.messages[0])).toEqual({ type: 'css', paths: ['site.css'] });
  });

  it('tells_openPages_toReload_whenAPageChanged_once_forASaveOfSeveralFiles', async () => {
    const stream: Awaited<ReturnType<typeof listen>> = await listen(site.port);

    onChange('index.html');
    onChange('site.css');
    onChange('.git/index');
    await until(() => stream.messages.length > 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    stream.request.destroy();

    expect(stream.messages).toHaveLength(1);
    expect(JSON.parse(stream.messages[0])).toEqual({
      type: 'reload',
      paths: ['index.html', 'site.css'],
    });
  });

  it('frees_itsPort_andStopsWatching_whenClosed', async () => {
    const port: number = site.port;

    await site.close();

    expect(watcher.closed).toBe(true);
    await expect(ask(port, '/')).rejects.toThrow();
    site = new LiveSite(root, () => null);
    expect(await site.listen(port)).toBe(port);
  });

  it('takes_theNextPort_whenTheFirstIsTaken', async () => {
    const next: LiveSite = new LiveSite(root, () => null);

    const port: number = await next.listen(site.port);
    await next.close();

    expect(port).toBeGreaterThan(site.port);
  });

  it('ignores_changesInDotFoldersAndDependencies', () => {
    expect(isServedChange('css/site.css')).toBe(true);
    expect(isServedChange('.git/HEAD')).toBe(false);
    expect(isServedChange('node_modules/x/index.js')).toBe(false);
  });
});
