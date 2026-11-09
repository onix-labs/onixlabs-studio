import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConnectOutcome,
  DatabaseEngineInfo,
  isCompatibleDatabaseEngineProtocol,
} from '@shared/api/database-engine-protocol';
import { parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import { type LockfilePackage, parseLockfileDocument } from '../../provisioning/lockfile-provision';
import { DatabaseEngineClient } from './database-engine-client';

/**
 * The per-test timeout: each plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * One engine plugin that talks to a database server over the network.
 */
interface NetworkEnginePlugin {
  /**
   * Gets the plugin's directory name, which is also its id.
   */
  readonly name: string;

  /**
   * Gets the engine's language.
   */
  readonly language: string;

  /**
   * Builds connection values aimed at a port nothing listens on.
   */
  readonly unreachable: (port: number) => Readonly<Record<string, string>>;
}

/**
 * The network engines (#1096). Neither contract needs a server: the protocol is spoken across the real
 * process boundary as far as a server would take over, and the rest is proved by the engines' own specs
 * with their drivers mocked.
 */
const PLUGINS: readonly NetworkEnginePlugin[] = [
  {
    name: 'postgres-engine',
    language: 'pgsql',
    unreachable: (port: number): Readonly<Record<string, string>> => ({
      host: '127.0.0.1',
      port: String(port),
      database: 'postgres',
      user: 'postgres',
      password: 'unused',
      ssl: 'disable',
    }),
  },
  {
    name: 'neo4j-engine',
    language: 'cypher',
    unreachable: (port: number): Readonly<Record<string, string>> => ({
      uri: `bolt://127.0.0.1:${port}`,
      database: 'neo4j',
      user: 'neo4j',
      password: 'unused',
    }),
  },
];

/**
 * Finds a local port nothing is listening on, by listening on one and closing it.
 * @returns Returns the port.
 */
function closedPort(): Promise<number> {
  return new Promise<number>((resolve: (port: number) => void): void => {
    const server: net.Server = net.createServer();
    server.listen(0, '127.0.0.1', (): void => {
      const port: number = (server.address() as net.AddressInfo).port;
      server.close((): void => resolve(port));
    });
  });
}

describe.each(PLUGINS)('$name contract', (plugin: NetworkEnginePlugin) => {
  const directory: string = path.resolve('plugins', plugin.name);
  let scratch: string;
  let client: DatabaseEngineClient;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${plugin.name}-contract-`)));
    const bundle: string = path.join(scratch, 'main.js');
    // esbuild's CLI rather than its API: the unit suite runs under jsdom, whose TextEncoder esbuild's
    // in-process API refuses. The externals are the plugin build's own.
    execFileSync(path.resolve('node_modules/.bin/esbuild'), [
      path.join(directory, 'src', 'main.ts'),
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=cjs',
      '--external:pg-native',
      '--external:cloudflare:sockets',
      `--outfile=${bundle}`,
      '--log-level=error',
    ]);
    client = new DatabaseEngineClient(plugin.name, { command: process.execPath, args: [bundle] });
  });

  afterAll(() => {
    client?.dispose();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('describesItselfAsTheManifestDoes', TIMEOUT, async () => {
    const manifest: PluginManifest = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8')),
    ).manifest!;
    const info: DatabaseEngineInfo | null = await client.info();

    expect(info?.id).toBe(manifest.contributes.databaseEngines?.[0]?.id);
    expect(info?.language).toBe(plugin.language);
    expect(info?.capabilities).toContain('cancel');
    // A password is a secret, so it is never written into a document nor shown to an agent.
    expect(
      info?.connectionFields.filter((field) => field.kind === 'password' && field.secret !== true),
    ).toEqual([]);
  });

  it('answersAnUnreachableServerAsAFailure_ratherThanFailingTheRequest', TIMEOUT, async () => {
    const port: number = await closedPort();
    const outcome: { ok: true; result: ConnectOutcome } | { ok: false; error: string } =
      await client.call('connect', { values: plugin.unreachable(port) });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.kind).toBe('failure');
  });

  describe('is installable', () => {
    const manifestText: string = fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8');
    const manifest: PluginManifest = parsePluginManifest(JSON.parse(manifestText)).manifest!;
    const lockfileText: string = fs.readFileSync(
      path.resolve(`src/shared/electron/contributions/plugins/lockfiles/${plugin.name}.lock.json`),
      'utf8',
    );
    const packages: readonly LockfilePackage[] = parseLockfileDocument(JSON.parse(lockfileText))!;
    const pkg: { name: string; version: string } = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ) as { name: string; version: string };

    it('pinsTheHashTheLockfileActuallyHas', () => {
      expect(manifest.provision.kind).toBe('npm');
      expect(createHash('sha256').update(lockfileText).digest('hex')).toBe(
        (manifest.provision as { sha256: string }).sha256,
      );
    });

    it('pinsALockfileFromTheDirectoryLockfilesLiveIn', () => {
      expect((manifest.provision as { lockfileUrl: string }).lockfileUrl).toBe(
        'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/' +
          `src/shared/electron/contributions/plugins/lockfiles/${plugin.name}.lock.json`,
      );
    });

    it('namesAnEntryPointTheTreeActuallyDelivers', () => {
      const entryPoint: string = manifest.contributes.databaseEngines![0].entryPoint ?? '';

      expect((manifest.provision as { executablePath: string }).executablePath).toBe(entryPoint);
      expect(
        packages.some((entry: LockfilePackage): boolean => entryPoint.startsWith(`${entry.path}/`)),
      ).toBe(true);
    });

    it('resolvesItsOwnPackageFromTheRelease', () => {
      const own: LockfilePackage | undefined = packages.find(
        (entry: LockfilePackage): boolean => entry.path === `node_modules/${pkg.name}`,
      );

      expect(own?.url).toBe(
        'https://github.com/onix-labs/onixlabs-studio/releases/download/' +
          `plugin-${plugin.name}-v${pkg.version}/onixlabs-${plugin.name}-${pkg.version}.tgz`,
      );
    });

    it('publishesTheVersionTheManifestNames', () => {
      expect(pkg.version).toBe(manifest.version);
    });

    it('speaksAProtocolVersionThisBuildHonours', () => {
      const source: string = fs.readFileSync(
        path.resolve('plugins/protocol/database/protocol.ts'),
        'utf8',
      );
      const declared: string =
        /DATABASE_ENGINE_PROTOCOL: string = '([^']+)'/.exec(source)?.[1] ?? '';

      expect(isCompatibleDatabaseEngineProtocol(declared)).toBe(true);
    });

    it('isCarriedByTheCuratedIndex', () => {
      const index: { plugins: readonly { id: string }[] } = JSON.parse(
        fs.readFileSync(
          path.resolve('src/shared/electron/contributions/plugins/curated-plugins.json'),
          'utf8',
        ),
      ) as { plugins: readonly { id: string }[] };

      expect(
        index.plugins.find((entry: { id: string }): boolean => entry.id === manifest.id),
      ).toEqual(JSON.parse(manifestText));
    });
  });
});
