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
 * The Conan plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/conan');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the Conan plugin (#917), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client,
 * against a fake Conan remote on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME` whose `.conan2/remotes.json` names only the fake, so
 * it cannot read the user's Conan remotes or reach ConanCenter.
 */
describe('Conan plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined }[] = [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'conan-plugin-contract-')));
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
      response.setHeader('content-type', 'application/json');
      if (url === '/v2/conans/search?q=fmt') {
        response.end(JSON.stringify({ results: ['fmt/10.2.1@_/_', 'fmt/12.2.0@_/_'] }));
      } else if (url === '/v2/conans/search?q=*fmt*') {
        response.end(
          JSON.stringify({ results: ['fmt/10.2.1@_/_', 'fmt/12.2.0@_/_', 'fmtlog/2.3.0@_/_'] }),
        );
      } else if (url.startsWith('/v2/conans/search')) {
        response.end(JSON.stringify({ results: [] }));
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const remote: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'conanfile.txt'), '[requires]\nfmt/[>=10 <13]\n');
    fs.writeFileSync(
      path.join(workspace, 'conan.lock'),
      JSON.stringify({ version: '0.5', requires: ['fmt/10.2.1#0123%1.0'] }),
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(path.join(home, '.conan2'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.conan2', 'remotes.json'),
      JSON.stringify({ remotes: [{ name: 'fixture', url: remote, verify_ssl: true }] }),
    );
    // A credential for a plain-http remote, which must never be sent.
    fs.writeFileSync(
      path.join(home, '.conan2', 'credentials.json'),
      JSON.stringify({
        credentials: [{ remote: 'fixture', user: 'me', password: 'fixture-token' }],
      }),
    );
    client = new PackageManagerClient(
      'onixlabs.conan',
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
    expect(parsed.manifest?.contributes.packageManagers?.[0].markers).toEqual([
      'conanfile.txt',
      'conanfile.py',
    ]);
    expect(description?.protocol).toBe('1.0');
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it('loadsAConanfileWithItsLockAgainstTheRemote', TIMEOUT, async () => {
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
    expect(model?.ecosystem).toBe('conan');
    expect(model?.projects[0].packages[0]).toEqual({
      name: 'fmt',
      requested: '[>=10 <13]',
      installed: '10.2.1',
      latest: '12.2.0',
      status: 'outdated',
      scope: 'production',
    });
    expect(
      requests.every(
        (request: { authorization: string | undefined }): boolean =>
          request.authorization === undefined,
      ),
    ).toBe(true);
  });

  it('namesItsRemotesWithoutTheirUrls', TIMEOUT, async () => {
    // Arrange
    await client.start();

    // Act
    const response: PackageManagerResponse<'sources'> = await client.request(
      'sources',
      workspace,
      {},
      15_000,
    );

    // Assert
    expect(response).toEqual({
      id: expect.any(Number) as unknown,
      ok: true,
      result: { sources: [{ name: 'fixture' }] },
    });
  });

  it('searchesTheRemote', TIMEOUT, async () => {
    // Arrange
    await client.start();

    // Act
    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      { source: 'fixture', query: 'fmt', skip: 0, take: 20, prerelease: false },
      15_000,
    );

    // Assert
    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(
      page?.items.map(
        (item: { name: string; version: string }): string => `${item.name}/${item.version}`,
      ),
    ).toEqual(['fmt/12.2.0', 'fmtlog/2.3.0']);
  });

  it('answersARestoreWithACommandAndRunsNothing', TIMEOUT, async () => {
    // Arrange
    await client.start();

    // Act
    const response: PackageManagerResponse<'restore'> = await client.request(
      'restore',
      workspace,
      { project: path.join(workspace, 'conanfile.txt') },
      15_000,
    );

    // Assert
    expect(response).toMatchObject({
      ok: true,
      result: { executable: 'conan', args: ['install', '.'], cwd: workspace },
    });
  });
});
