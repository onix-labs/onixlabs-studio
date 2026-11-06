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
 * The npm plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/npm');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the npm plugin (#909), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client,
 * against a fake registry on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME`, so it cannot read the user's `~/.npmrc`, and every
 * registry it can reach is named by the fixture's own `.npmrc`.
 */
describe('npm plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let registry: string = '';
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined }[] = [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'npm-plugin-contract-')));
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
      requests.push({ url: request.url ?? '', authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      if ((request.url ?? '').startsWith('/-/v1/search')) {
        response.end(
          JSON.stringify({
            total: 1,
            objects: [
              {
                package: { name: 'left-pad', version: '1.3.0', description: 'pads' },
                downloads: { monthly: 1200 },
              },
            ],
          }),
        );
      } else {
        response.end(JSON.stringify({ 'dist-tags': { latest: '2.0.0' } }));
      }
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { 'left-pad': '^1.0.0' } }),
    );
    fs.writeFileSync(
      path.join(workspace, 'package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/left-pad': { version: '1.0.0' } } }),
    );
    fs.writeFileSync(
      path.join(workspace, '.npmrc'),
      `registry=${registry}/\n${registry.replace('http:', '')}/:_authToken=fixture-token\n`,
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(home);
    client = new PackageManagerClient(
      'onixlabs.npm',
      {
        command: process.execPath,
        args: [bundle],
        env: { HOME: home, USERPROFILE: home },
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

  it('loadsAFolderThroughItsRegistry_withTheConfiguredCredential', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      workspace,
      {},
      15_000,
    );

    const model: PackageManagerModel | null = response.ok ? response.result : null;
    expect(model?.ecosystem).toBe('npm');
    expect(model?.projects[0].packages[0]).toMatchObject({
      name: 'left-pad',
      installed: '1.0.0',
      latest: '2.0.0',
      status: 'outdated',
    });
    expect(requests[0]).toEqual({ url: '/left-pad', authorization: 'Bearer fixture-token' });
  });

  it('namesItsSourcesWithoutTheirUrls', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'sources'> = await client.request(
      'sources',
      workspace,
      {},
      15_000,
    );

    expect(response).toMatchObject({
      ok: true,
      result: { sources: [{ name: registry.replace('http://', '') }] },
    });
  });

  it('searchesThroughTheRegistry', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      {
        source: registry.replace('http://', ''),
        query: 'left-pad',
        skip: 0,
        take: 20,
        prerelease: false,
      },
      15_000,
    );

    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items[0]).toMatchObject({ name: 'left-pad', downloads: 1200 });
    expect(requests.at(-1)?.url).toBe('/-/v1/search?text=left-pad&size=20&from=0');
  });

  it('answersAWriteWithACommandAndRunsNothing', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'install'> = await client.request(
      'install',
      workspace,
      { project: path.join(workspace, 'package.json'), name: 'left-pad', version: '1.3.0' },
      15_000,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        executable: 'npm',
        args: ['install', 'left-pad@1.3.0'],
        cwd: workspace,
        title: 'Install left-pad',
      },
    });
    expect(fs.existsSync(path.join(workspace, 'node_modules'))).toBe(false);
  });

  it('refusesANameThatWouldBeReadAsAnOption', TIMEOUT, async () => {
    await client.start();

    await expect(
      client.request(
        'remove',
        workspace,
        { project: path.join(workspace, 'package.json'), name: '--global' },
        15_000,
      ),
    ).resolves.toMatchObject({ ok: false });
  });
});
