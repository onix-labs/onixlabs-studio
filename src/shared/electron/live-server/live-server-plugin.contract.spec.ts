import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ManifestLiveServer,
  ManifestResult,
  parsePluginManifest,
} from '@shared/api/plugin-manifest';
import type { LiveServerInfo, LiveServerOpenAnswer } from '@shared/api/live-server-channels';
import { LiveServerDescriptor, LiveServerResolution } from './live-server-descriptor';
import { LiveServerHost } from './live-server-host';

/**
 * The plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/live-server');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: number = 30_000;

/**
 * A response read whole.
 */
interface Answer {
  readonly status: number;
  readonly body: string;
}

/**
 * Asks for a URL's path exactly as written, as a hostile client would.
 * @param url The server's address.
 * @param target The request target.
 * @returns Returns the response.
 */
function ask(url: string, target: string): Promise<Answer> {
  const parsed: URL = new URL(url);
  return new Promise<Answer>((resolve, reject) => {
    const request: http.ClientRequest = http.request(
      { host: parsed.hostname, port: parsed.port, path: target },
      (response: http.IncomingMessage) => {
        let body: string = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * The contract between core's live-server host and the Live Server plugin (#1062), across the real
 * process boundary: the plugin is bundled as its build does, spawned under Node, and spoken to by the
 * host's own client — and its server is asked for pages over real HTTP.
 */
describe('Live Server plugin contract (#1062)', () => {
  let scratch: string = '';
  let workspace: string = '';
  let host: LiveServerHost;
  const announced: (readonly LiveServerInfo[])[] = [];

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'live-server-contract-')));
    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'index.html'), '<html><body>home</body></html>');
    fs.writeFileSync(path.join(workspace, 'docs', 'about.html'), '<p>about</p>');
    fs.writeFileSync(path.join(scratch, 'secret.txt'), 'secret');
    const bundle: string = path.join(scratch, 'main.js');
    // esbuild's CLI rather than its API: the unit suite runs under jsdom, whose TextEncoder esbuild's
    // in-process API refuses.
    execFileSync(path.resolve('node_modules/.bin/esbuild'), [
      path.join(PLUGIN, 'src', 'main.ts'),
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=cjs',
      `--outfile=${bundle}`,
      '--log-level=error',
    ]);
    const parsed: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const contribution: ManifestLiveServer | undefined =
      parsed.manifest?.contributes.liveServers?.[0];
    host = new LiveServerHost({
      descriptors: (): readonly LiveServerDescriptor[] =>
        contribution === undefined
          ? []
          : [
              {
                id: contribution.id,
                displayName: contribution.displayName,
                priority: contribution.priority,
                resolve: (): LiveServerResolution => ({
                  available: true,
                  spec: { command: process.execPath, args: [bundle] },
                }),
              },
            ],
      roots: {
        isWithin: (target: unknown): boolean => String(target).startsWith(workspace),
        isRoot: (target: string): boolean => target === workspace,
        rootContaining: (target: string): string | undefined =>
          target.startsWith(workspace + path.sep) ? workspace : undefined,
      },
      onChanged: (servers: readonly LiveServerInfo[]): void => {
        announced.push(servers);
      },
    });
  });

  afterAll(() => {
    host.dispose();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('declares_aLiveServer_inAManifestThisBuildAccepts', () => {
    const parsed: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest?.contributes.liveServers).toHaveLength(1);
  });

  it(
    'serves_theWorkspace_onTheLoopbackAddress_andConfinesItsRequests',
    async () => {
      const answer: LiveServerOpenAnswer = await host.open(
        path.join(workspace, 'docs', 'about.html'),
      );
      if (!answer.ok) {
        throw new Error(answer.error);
      }

      expect(answer.server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(answer.pageUrl).toBe(`${answer.server.url}docs/about.html`);
      const page: Answer = await ask(answer.server.url, '/docs/about.html');
      expect(page.status).toBe(200);
      expect(page.body).toContain('/__live-server/client.js');
      expect((await ask(answer.server.url, '/')).body).toContain('home');
      const escape: Answer = await ask(answer.server.url, '/../secret.txt');
      expect(escape.status).toBe(403);
      expect(escape.body).not.toContain('secret');
      expect(announced.at(-1)).toEqual([answer.server]);
    },
    TIMEOUT,
  );

  it(
    'reuses_theServer_forAnotherPage',
    async () => {
      const first: LiveServerOpenAnswer = await host.open(path.join(workspace, 'index.html'));
      const second: LiveServerOpenAnswer = await host.open(
        path.join(workspace, 'docs', 'about.html'),
      );

      expect(first.ok && second.ok && first.server.port === second.server.port).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'frees_thePort_whenStopped',
    async () => {
      const answer: LiveServerOpenAnswer = await host.open(path.join(workspace, 'index.html'));
      if (!answer.ok) {
        throw new Error(answer.error);
      }

      await host.stop(workspace);

      expect(host.list()).toEqual([]);
      await expect(ask(answer.server.url, '/')).rejects.toThrow();
    },
    TIMEOUT,
  );
});
