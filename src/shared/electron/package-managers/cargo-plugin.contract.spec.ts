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
 * The Cargo plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/cargo');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the Cargo plugin (#914), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client,
 * against a fake registry on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME` and `CARGO_HOME`, so it cannot read the user's cargo
 * config or credentials. The fixture's `.cargo/config.toml` replaces crates.io with the fake registry,
 * so the fake is the only thing it can reach.
 */
describe('Cargo plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined; agent: string | undefined }[] =
    [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cargo-plugin-contract-')));
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
      const base: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      requests.push({
        url,
        authorization: request.headers.authorization,
        agent: request.headers['user-agent'],
      });
      if (url === '/index/config.json') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ dl: `${base}/dl`, api: base }));
      } else if (url === '/index/se/rd/serde') {
        response.end(
          ['1.0.190', '1.0.200', '2.0.0-alpha.1']
            .map((vers: string): string => JSON.stringify({ name: 'serde', vers, yanked: false }))
            .join('\n'),
        );
      } else if (url.startsWith('/api/v1/crates?')) {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            crates: [
              {
                name: 'serde',
                description: 'A serialization framework',
                downloads: 900,
                max_version: '2.0.0-alpha.1',
                max_stable_version: '1.0.200',
              },
            ],
            meta: { total: 1, next_page: null },
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
    const index: string = `sparse+http://127.0.0.1:${(server.address() as AddressInfo).port}/index/`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(path.join(workspace, 'app'), { recursive: true });
    fs.mkdirSync(path.join(workspace, '.cargo'));
    fs.writeFileSync(path.join(workspace, 'Cargo.toml'), '[workspace]\nmembers = ["app"]\n');
    fs.writeFileSync(
      path.join(workspace, 'app', 'Cargo.toml'),
      '[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nserde = "1.0"\n',
    );
    fs.writeFileSync(
      path.join(workspace, 'Cargo.lock'),
      'version = 4\n[[package]]\nname = "serde"\nversion = "1.0.190"\n',
    );
    fs.writeFileSync(
      path.join(workspace, '.cargo', 'config.toml'),
      `[source.crates-io]\nreplace-with = "fixture"\n[registries.fixture]\nindex = "${index}"\ntoken = "fixture-token"\n`,
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(path.join(home, '.cargo'), { recursive: true });
    client = new PackageManagerClient(
      'onixlabs.cargo',
      {
        command: process.execPath,
        args: [bundle],
        env: { HOME: home, USERPROFILE: home, CARGO_HOME: path.join(home, '.cargo') },
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
    expect(description?.protocol).toBe('1.0');
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it('loadsAWorkspaceThroughItsRegistry_withTheConfiguredCredential', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      workspace,
      {},
      15_000,
    );

    const model: PackageManagerModel | null = response.ok ? response.result : null;
    expect(model?.ecosystem).toBe('cargo');
    expect(model?.projects).toHaveLength(1);
    expect(model?.projects[0]).toMatchObject({
      name: 'app',
      manifestPath: path.join(workspace, 'app', 'Cargo.toml'),
    });
    expect(model?.projects[0].packages[0]).toEqual({
      name: 'serde',
      requested: '1.0',
      installed: '1.0.190',
      latest: '1.0.200',
      status: 'outdated',
      scope: 'production',
    });
    const lookup: (typeof requests)[number] | undefined = requests.find(
      (request: (typeof requests)[number]): boolean => request.url === '/index/se/rd/serde',
    );
    expect(lookup?.authorization).toBe('fixture-token');
    expect(lookup?.agent).toMatch(/onixlabs-studio/);
  });

  it('namesItsSourcesWithoutTheirUrls', TIMEOUT, async () => {
    await client.start();

    await expect(client.request('sources', workspace, {}, 15_000)).resolves.toMatchObject({
      ok: true,
      result: { sources: [{ name: 'crates.io' }, { name: 'fixture' }] },
    });
  });

  it('searchesThroughTheApiTheIndexDeclares', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      { source: 'crates.io', query: 'serde', skip: 0, take: 20, prerelease: false },
      15_000,
    );

    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items[0]).toMatchObject({ name: 'serde', version: '1.0.200', downloads: 900 });
    expect(requests.at(-1)?.url).toBe('/api/v1/crates?q=serde&page=1&per_page=20');
  });

  it('answersAWriteWithACommandAndRunsNothing', TIMEOUT, async () => {
    await client.start();
    const manifest: string = path.join(workspace, 'app', 'Cargo.toml');

    await expect(
      client.request(
        'install',
        workspace,
        { project: manifest, name: 'anyhow', version: '1.0' },
        15_000,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        executable: 'cargo',
        args: ['add', 'anyhow@1.0', '--manifest-path', manifest],
        cwd: path.join(workspace, 'app'),
      },
    });
  });

  it('refusesAWriteToAWorkspaceWithNoCrateOfItsOwn', TIMEOUT, async () => {
    await client.start();

    await expect(
      client.request(
        'install',
        workspace,
        { project: path.join(workspace, 'Cargo.toml'), name: 'anyhow', version: null },
        15_000,
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});
