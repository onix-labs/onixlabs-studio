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
 * The PyPI plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/pypi');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the PyPI plugin (#913), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client,
 * against a fake PEP 691 index on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME` (and `XDG_CONFIG_HOME`, `APPDATA`), so it cannot read
 * the user's `pip.conf`, and the only index it can reach is the one the scratch `pip.conf` names.
 */
describe('PyPI plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let index: string = '';
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined; accept: string | undefined }[] =
    [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pypi-plugin-contract-')));
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
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization,
        accept: request.headers.accept,
      });
      response.setHeader('content-type', 'application/vnd.pypi.simple.v1+json');
      if (request.url === '/simple/requests/') {
        response.end(
          JSON.stringify({
            meta: { 'api-version': '1.1' },
            name: 'requests',
            versions: ['2.31.0', '2.32.3', '3.0.0b1'],
            files: [
              { filename: 'requests-2.31.0-py3-none-any.whl', yanked: false },
              { filename: 'requests-2.32.3-py3-none-any.whl', yanked: false },
              { filename: 'requests-3.0.0b1-py3-none-any.whl', yanked: false },
            ],
          }),
        );
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    index = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, 'pyproject.toml'),
      '[project]\nname = "demo"\ndependencies = ["requests>=2.31"]\n',
    );
    fs.writeFileSync(
      path.join(workspace, 'uv.lock'),
      'version = 1\n\n[[package]]\nname = "requests"\nversion = "2.31.0"\n',
    );

    const home: string = path.join(scratch, 'home');
    // The legacy location, read on every platform but Windows; Windows reads `%APPDATA%\pip\pip.ini`.
    for (const config of [path.join(home, '.pip', 'pip.conf'), path.join(home, 'pip', 'pip.ini')]) {
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(
        config,
        `[global]\nindex-url = ${index.replace('http://', 'http://me:fixture-token@')}/simple\n`,
      );
    }
    client = new PackageManagerClient(
      'onixlabs.pypi',
      {
        command: process.execPath,
        args: [bundle],
        env: {
          HOME: home,
          USERPROFILE: home,
          APPDATA: path.join(home, 'AppData'),
          XDG_CONFIG_HOME: path.join(home, '.config'),
        },
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

  it('loadsAFolderThroughItsIndex_withTheConfiguredCredential', TIMEOUT, async () => {
    await client.start();
    // The registry's log is shared by every test in the file; this one asserts on its own first
    // request, so it starts from an empty log whatever ran before it.
    requests.length = 0;

    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      workspace,
      {},
      15_000,
    );

    const model: PackageManagerModel | null = response.ok ? response.result : null;
    expect(model?.ecosystem).toBe('pypi');
    expect(model?.projects[0]).toMatchObject({
      name: 'demo',
      manifestPath: path.join(workspace, 'pyproject.toml'),
    });
    expect(model?.projects[0].packages[0]).toMatchObject({
      name: 'requests',
      requested: '>=2.31',
      installed: '2.31.0',
      latest: '2.32.3',
      status: 'outdated',
      scope: 'production',
    });
    expect(requests[0]).toEqual({
      url: '/simple/requests/',
      authorization: `Basic ${Buffer.from('me:fixture-token').toString('base64')}`,
      accept: 'application/vnd.pypi.simple.v1+json',
    });
  });

  it('namesItsSourcesWithoutTheirCredentials', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'sources'> = await client.request(
      'sources',
      workspace,
      {},
      15_000,
    );

    expect(response).toMatchObject({
      ok: true,
      result: { sources: [{ name: index.replace('http://', '') }] },
    });
    expect(JSON.stringify(response)).not.toContain('fixture-token');
  });

  it('looksAnExactNameUp', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      {
        source: index.replace('http://', ''),
        query: 'Requests',
        skip: 0,
        take: 20,
        prerelease: false,
      },
      15_000,
    );

    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items).toEqual([
      {
        name: 'requests',
        version: '2.32.3',
        description: '',
        downloads: null,
        verified: false,
        sourceName: index.replace('http://', ''),
      },
    ]);
    expect(requests.at(-1)?.url).toBe('/simple/requests/');
  });

  it('answersAWriteWithACommandAndRunsNothing', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'install'> = await client.request(
      'install',
      workspace,
      { project: path.join(workspace, 'pyproject.toml'), name: 'rich', version: '13.7.1' },
      15_000,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        executable: 'uv',
        args: ['add', 'rich==13.7.1'],
        cwd: workspace,
        title: 'Install rich',
      },
    });
    expect(fs.existsSync(path.join(workspace, '.venv'))).toBe(false);
  });

  it('refusesANameThatWouldBeReadAsAnOption', TIMEOUT, async () => {
    await client.start();

    await expect(
      client.request(
        'remove',
        workspace,
        { project: path.join(workspace, 'pyproject.toml'), name: '--frozen' },
        15_000,
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});
