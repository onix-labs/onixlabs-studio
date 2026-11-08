import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePluginManifest } from '@shared/api/plugin-manifest';
import type { PackageManagerModel, PackageSearchResult } from '@shared/api/package-management';
import type {
  PackageManagerDescription,
  PackageManagerResponse,
} from '@shared/api/package-manager-protocol';
import { PackageManagerClient } from './package-manager-client';

/**
 * The Go modules plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/go-modules');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the Go modules plugin (#915), tested across the real process boundary:
 * the plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own
 * client, against a fake module proxy on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME`, and `GOENV` names a go environment file in the
 * scratch folder, so it cannot read the user's Go settings or `.netrc`, and the only proxy it can reach
 * is the fake one that file names.
 */
describe('Go modules plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let proxy: string = '';
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined }[] = [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'go-plugin-contract-')));
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
    server = http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
      const url: string = request.url ?? '';
      requests.push({ url, authorization: request.headers.authorization });
      if (url === '/go/github.com/!burnt!sushi/toml/@v/list') {
        response.end('v1.3.2\nv1.4.0\nv1.5.0-rc.1\n');
      } else if (url === '/go/golang.org/x/mod/@v/list') {
        response.end('v0.20.0\n');
      } else {
        response.statusCode = 404;
        response.end('not found');
      }
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port: number = (server.address() as AddressInfo).port;
    proxy = `127.0.0.1:${port}/go`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, 'go.mod'),
      [
        'module example.com/demo',
        '',
        'go 1.22',
        '',
        'require (',
        '\tgithub.com/BurntSushi/toml v1.3.2',
        '\tgolang.org/x/sys v0.21.0 // indirect',
        '\tcorp.example/secret v1.0.0',
        ')',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(workspace, 'go.sum'),
      'github.com/BurntSushi/toml v1.3.2 h1:fixture=\ngithub.com/BurntSushi/toml v1.3.2/go.mod h1:fixture=\n',
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(home);
    fs.writeFileSync(
      path.join(home, '.netrc'),
      'machine 127.0.0.1 login fixture password fixture-pass\n',
    );
    const goEnv: string = path.join(scratch, 'go-env');
    fs.writeFileSync(goEnv, `GOPROXY=http://${proxy},off\nGOPRIVATE=corp.example\n`);
    client = new PackageManagerClient(
      'onixlabs.go-modules',
      {
        command: process.execPath,
        args: [bundle],
        env: { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, GOENV: goEnv },
      },
      (): Promise<string | null> => Promise.resolve(null),
    );
  });

  afterAll(async () => {
    client.dispose();
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => resolve());
    });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('itsManifestIsValidAndConfirmedByTheHandshake', TIMEOUT, async () => {
    const parsed: ReturnType<typeof parsePluginManifest> = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const declared: readonly string[] =
      parsed.manifest?.contributes.packageManagers?.[0].capabilities ?? [];

    const description: PackageManagerDescription | null = await client.start();

    expect(parsed.errors).toEqual([]);
    expect(description?.protocol).toBe('1.1');
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it(
    'loadsAModuleThroughItsProxy_withTheNetrcCredential_andKeepsPrivateModulesOff',
    TIMEOUT,
    async () => {
      await client.start();
      // The proxy's log is shared by every test in the file; this one asserts on exactly what its
      // load asked for, so it starts from an empty log whatever ran before it.
      requests.length = 0;

      const response: PackageManagerResponse<'load'> = await client.request(
        'load',
        workspace,
        {},
        15_000,
      );

      const model: PackageManagerModel | null = response.ok ? response.result : null;
      expect(model?.ecosystem).toBe('go');
      expect(model?.projects[0]).toMatchObject({
        name: 'example.com/demo',
        manifestPath: path.join(workspace, 'go.mod'),
      });
      expect(model?.projects[0].packages).toEqual([
        {
          name: 'github.com/BurntSushi/toml',
          requested: 'v1.3.2',
          installed: 'v1.3.2',
          latest: 'v1.4.0',
          status: 'outdated',
          scope: 'production',
        },
        {
          name: 'corp.example/secret',
          requested: 'v1.0.0',
          installed: null,
          latest: null,
          status: 'unknown',
          scope: 'production',
        },
      ]);
      expect(requests).toEqual([
        {
          url: '/go/github.com/!burnt!sushi/toml/@v/list',
          authorization: `Basic ${Buffer.from('fixture:fixture-pass').toString('base64')}`,
        },
      ]);
    },
  );

  it('namesItsSourcesWithoutTheirUrls', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'sources'> = await client.request(
      'sources',
      workspace,
      {},
      15_000,
    );

    expect(response).toMatchObject({ ok: true, result: { sources: [{ name: proxy }] } });
  });

  it('looksUpAnExactModulePath', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      { source: proxy, query: 'golang.org/x/mod', skip: 0, take: 20, prerelease: false },
      15_000,
    );

    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items).toEqual([
      {
        name: 'golang.org/x/mod',
        version: 'v0.20.0',
        description: '',
        downloads: null,
        verified: false,
        sourceName: proxy,
      },
    ]);
    expect(requests.at(-1)?.url).toBe('/go/golang.org/x/mod/@v/list');
  });

  it('answersAWriteWithACommandAndRunsNothing', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'update'> = await client.request(
      'update',
      workspace,
      {
        project: path.join(workspace, 'go.mod'),
        name: 'github.com/BurntSushi/toml',
        version: 'v1.4.0',
      },
      15_000,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        executable: 'go',
        args: ['get', 'github.com/BurntSushi/toml@v1.4.0'],
        cwd: workspace,
        title: 'Update github.com/BurntSushi/toml',
      },
    });
    expect(fs.readFileSync(path.join(workspace, 'go.mod'), 'utf8')).toContain(
      'github.com/BurntSushi/toml v1.3.2',
    );
  });

  it('refusesANameThatWouldBeReadAsAnOption', TIMEOUT, async () => {
    await client.start();

    await expect(
      client.request(
        'remove',
        workspace,
        { project: path.join(workspace, 'go.mod'), name: '-modfile=/tmp/x' },
        15_000,
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});
