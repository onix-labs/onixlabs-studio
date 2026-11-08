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
 * The vcpkg plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/vcpkg');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The baseline the fixture manifest pins.
 */
const PINNED: string = 'e'.repeat(40);

/**
 * The contract between core and the vcpkg plugin (#917), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client,
 * against a fake registry on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME`, and pointed at the fake by the one variable it
 * honours only for a loopback address, so it cannot reach the real registry.
 */
describe('vcpkg plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let client: PackageManagerClient;
  const requests: string[] = [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vcpkg-plugin-contract-')));
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
      requests.push(url);
      response.setHeader('content-type', 'application/json');
      if (url === `/microsoft/vcpkg/${PINNED}/versions/baseline.json`) {
        response.end(
          JSON.stringify({ default: { fmt: { baseline: '10.1.1', 'port-version': 0 } } }),
        );
      } else if (url === '/microsoft/vcpkg/master/versions/baseline.json') {
        response.end(
          JSON.stringify({
            default: {
              fmt: { baseline: '12.2.0', 'port-version': 1 },
              fmtlog: { baseline: '2.3.0', 'port-version': 0 },
              zlib: { baseline: '1.3.2', 'port-version': 0 },
            },
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
    const registry: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}/microsoft/vcpkg`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, 'vcpkg.json'),
      JSON.stringify({ name: 'app', 'builtin-baseline': PINNED, dependencies: ['fmt'] }),
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(home);
    client = new PackageManagerClient(
      'onixlabs.vcpkg',
      {
        command: process.execPath,
        args: [bundle],
        env: { HOME: home, USERPROFILE: home, STUDIO_VCPKG_REGISTRY_URL: registry },
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
    // Arrange
    const parsed: ReturnType<typeof parsePluginManifest> = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const declared: readonly string[] =
      parsed.manifest?.contributes.packageManagers?.[0].capabilities ?? [];

    // Act
    const description: PackageManagerDescription | null = await client.start();

    // Assert
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest?.contributes.packageManagers?.[0].markers).toEqual(['vcpkg.json']);
    expect(description?.protocol).toBe('1.0');
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it('loadsAManifestAgainstItsBaselineAndTheLatest', TIMEOUT, async () => {
    // Arrange
    await client.start();

    // Act
    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      workspace,
      {},
      15_000,
    );

    // Assert
    const model: PackageManagerModel | null = response.ok ? response.result : null;
    expect(model?.ecosystem).toBe('vcpkg');
    expect(model?.projects[0].packages[0]).toEqual({
      name: 'fmt',
      requested: 'baseline',
      installed: '10.1.1',
      latest: '12.2.0#1',
      status: 'outdated',
      scope: 'production',
    });
  });

  it('searchesThePortList', TIMEOUT, async () => {
    // Arrange
    await client.start();

    // Act
    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      { source: 'vcpkg', query: 'fmt', skip: 0, take: 20, prerelease: false },
      15_000,
    );

    // Assert
    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items.map((item: { name: string }): string => item.name)).toEqual([
      'fmt',
      'fmtlog',
    ]);
  });

  it('answersAWriteWithACommandAndRunsNothing', TIMEOUT, async () => {
    // Arrange
    await client.start();

    // Act
    const response: PackageManagerResponse<'install'> = await client.request(
      'install',
      workspace,
      { project: path.join(workspace, 'vcpkg.json'), name: 'zlib', version: null },
      15_000,
    );

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: { executable: 'vcpkg', args: ['add', 'port', 'zlib'], cwd: workspace },
    });
    expect(fs.readFileSync(path.join(workspace, 'vcpkg.json'), 'utf8')).not.toContain('zlib');
  });
});
