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
 * The NuGet plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/nuget');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the NuGet plugin (#910), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client,
 * against a fake feed on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME`, so it cannot read the user's `NuGet.Config`. The
 * fixture's `nuget.config` clears every inherited source, nuget.org included, so the fake feed is the
 * only thing it can reach.
 */
describe('NuGet plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined }[] = [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-plugin-contract-')));
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
      requests.push({ url, authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      if (url === '/v3/index.json') {
        response.end(
          JSON.stringify({
            resources: [
              { '@id': `${base}/flat/`, '@type': 'PackageBaseAddress/3.0.0' },
              { '@id': `${base}/query`, '@type': 'SearchQueryService/3.5.0' },
            ],
          }),
        );
      } else if (url.startsWith('/flat/serilog/')) {
        response.end(JSON.stringify({ versions: ['3.0.0', '4.0.0', '5.0.0-beta'] }));
      } else if (url.startsWith('/query')) {
        response.end(
          JSON.stringify({
            totalHits: 1,
            data: [
              {
                id: 'Serilog',
                version: '4.0.0',
                description: 'Logging',
                totalDownloads: 900,
                verified: true,
              },
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
    const feed: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/index.json`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, 'Api.csproj'),
      '<Project><ItemGroup><PackageReference Include="Serilog" Version="3.0.0" /></ItemGroup></Project>',
    );
    fs.writeFileSync(
      path.join(workspace, 'nuget.config'),
      `<configuration>
        <packageSources><clear /><add key="fixture" value="${feed}" /></packageSources>
        <packageSourceCredentials>
          <fixture>
            <add key="Username" value="me" />
            <add key="ClearTextPassword" value="fixture-token" />
          </fixture>
        </packageSourceCredentials>
      </configuration>`,
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(home);
    client = new PackageManagerClient(
      'onixlabs.nuget',
      {
        command: process.execPath,
        args: [bundle],
        env: { HOME: home, USERPROFILE: home, APPDATA: home },
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

  it('itTakesPrecedenceOverNpm_asCoreDoes', () => {
    const priority: (name: string) => number | undefined = (name: string): number | undefined =>
      parsePluginManifest(
        JSON.parse(fs.readFileSync(path.resolve('plugins', name, 'plugin.json'), 'utf8')),
      ).manifest?.contributes.packageManagers?.[0].priority;

    expect(priority('nuget')).toBeGreaterThan(priority('npm') ?? 0);
  });

  it('loadsAFolderThroughItsFeed_withTheConfiguredCredential', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      workspace,
      {},
      15_000,
    );

    const model: PackageManagerModel | null = response.ok ? response.result : null;
    expect(model?.ecosystem).toBe('nuget');
    expect(model?.projects[0].packages[0]).toMatchObject({
      name: 'Serilog',
      requested: '3.0.0',
      latest: '4.0.0',
      status: 'outdated',
    });
    expect(requests[0]).toEqual({
      url: '/v3/index.json',
      authorization: `Basic ${Buffer.from('me:fixture-token').toString('base64')}`,
    });
  });

  it('namesItsSourcesWithoutTheirUrls', TIMEOUT, async () => {
    await client.start();

    await expect(client.request('sources', workspace, {}, 15_000)).resolves.toMatchObject({
      ok: true,
      result: { sources: [{ name: 'fixture' }] },
    });
  });

  it('browsesAFeedWithNoQuery', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      { source: 'fixture', query: '', skip: 0, take: 20, prerelease: true },
      15_000,
    );

    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items[0]).toMatchObject({ name: 'Serilog', downloads: 900, verified: true });
    expect(requests.at(-1)?.url).toContain('prerelease=true');
  });

  it('answersAWriteWithACommandAndRunsNothing', TIMEOUT, async () => {
    await client.start();

    await expect(
      client.request(
        'install',
        workspace,
        { project: path.join(workspace, 'Api.csproj'), name: 'Serilog', version: '4.0.0' },
        15_000,
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        executable: 'dotnet',
        args: ['add', 'Api.csproj', 'package', 'Serilog', '--version', '4.0.0'],
        cwd: workspace,
      },
    });
  });
});
