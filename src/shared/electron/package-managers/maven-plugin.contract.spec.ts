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
 * The Maven and Gradle plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/maven');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the Maven and Gradle plugin (#916), tested across the real process
 * boundary: the plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's
 * own client, against a fake repository and a fake Maven Central search on the loopback interface.
 *
 * ⛔ The plugin is started with a scratch `HOME`, so it cannot read the user's `~/.m2/settings.xml` or
 * `~/.gradle`. The scratch settings mirror every repository (`mirrorOf *`) to the fake, so it is the
 * only repository the plugin can reach, and the search is pointed at the fake by the loopback-only
 * override.
 */
describe('Maven plugin contract', () => {
  let scratch: string = '';
  let workspace: string = '';
  let server: http.Server;
  let client: PackageManagerClient;
  const requests: { url: string; authorization: string | undefined }[] = [];

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maven-plugin-contract-')));
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
      if (url === '/maven2/com/google/guava/guava/maven-metadata.xml') {
        response.setHeader('content-type', 'application/xml');
        response.end(
          '<metadata><versioning><versions><version>32.0.0-jre</version><version>33.0.0-jre</version><version>34.0.0-rc1-jre</version></versions></versioning></metadata>',
        );
      } else if (url.startsWith('/solrsearch/select')) {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            response: {
              numFound: 1,
              docs: [{ g: 'com.google.guava', a: 'guava', latestVersion: '33.0.0-jre' }],
            },
          }),
        );
      } else {
        response.statusCode = 404;
        response.end('');
      }
    });
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const base: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, 'pom.xml'),
      `<project>
        <groupId>com.example</groupId><artifactId>demo</artifactId><version>1.0</version>
        <dependencies>
          <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>32.0.0-jre</version></dependency>
        </dependencies>
      </project>`,
    );

    const home: string = path.join(scratch, 'home');
    fs.mkdirSync(path.join(home, '.m2'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.m2', 'settings.xml'),
      `<settings>
        <mirrors><mirror><id>fixture</id><url>${base}/maven2</url><mirrorOf>*</mirrorOf></mirror></mirrors>
        <servers><server><id>fixture</id><username>me</username><password>fixture-token</password></server></servers>
      </settings>`,
    );
    client = new PackageManagerClient(
      'onixlabs.maven',
      {
        command: process.execPath,
        args: [bundle],
        env: {
          HOME: home,
          USERPROFILE: home,
          ONIXLABS_MAVEN_SEARCH_URL: `${base}/solrsearch/select`,
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
    expect(description?.protocol).toBe('1.0');
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it('itAdvertisesNoWriteMavenAndGradleCannotDo', () => {
    const parsed: ReturnType<typeof parsePluginManifest> = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );

    const capabilities: readonly string[] =
      parsed.manifest?.contributes.packageManagers?.[0].capabilities ?? [];

    expect(capabilities).toContain('restore');
    expect(capabilities).not.toContain('install');
    expect(capabilities).not.toContain('update');
    expect(capabilities).not.toContain('remove');
  });

  it('loadsAFolderThroughTheMirror_withItsServerCredential', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      workspace,
      {},
      15_000,
    );

    const model: PackageManagerModel | null = response.ok ? response.result : null;
    expect(model?.ecosystem).toBe('maven');
    expect(model?.projects[0].packages[0]).toMatchObject({
      name: 'com.google.guava:guava',
      requested: '32.0.0-jre',
      latest: '33.0.0-jre',
      status: 'outdated',
      scope: 'production',
    });
    expect(requests[0]).toEqual({
      url: '/maven2/com/google/guava/guava/maven-metadata.xml',
      authorization: `Basic ${Buffer.from('me:fixture-token').toString('base64')}`,
    });
  });

  it('namesMavenCentralAsItsOnlySource', TIMEOUT, async () => {
    await client.start();

    await expect(client.request('sources', workspace, {}, 15_000)).resolves.toMatchObject({
      ok: true,
      result: { sources: [{ name: 'Maven Central' }] },
    });
  });

  it('searchesMavenCentral_withoutACredential', TIMEOUT, async () => {
    await client.start();

    const response: PackageManagerResponse<'search'> = await client.request(
      'search',
      workspace,
      { source: 'Maven Central', query: 'guava', skip: 0, take: 20, prerelease: false },
      15_000,
    );

    const page: PackageSearchResult | null = response.ok ? response.result : null;
    expect(page?.items[0]).toMatchObject({ name: 'com.google.guava:guava', version: '33.0.0-jre' });
    expect(requests.at(-1)).toEqual({
      url: '/solrsearch/select?q=guava&rows=20&start=0&wt=json',
      authorization: undefined,
    });
  });

  it('answersARestoreWithACommandAndRunsNothing', TIMEOUT, async () => {
    await client.start();

    await expect(
      client.request('restore', workspace, { project: path.join(workspace, 'pom.xml') }, 15_000),
    ).resolves.toMatchObject({
      ok: true,
      result: { executable: 'mvn', args: ['-f', 'pom.xml', 'dependency:resolve'], cwd: workspace },
    });
  });
});
