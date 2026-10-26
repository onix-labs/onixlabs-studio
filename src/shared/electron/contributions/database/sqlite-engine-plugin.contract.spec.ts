import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConnectOutcome,
  DatabaseEngineInfo,
  DatabaseNode,
  ExecuteOutcome,
  ExpandOutcome,
  isCompatibleDatabaseEngineProtocol,
} from '@shared/api/database-engine-protocol';
import { parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import { type LockfilePackage, parseLockfileDocument } from '../../provisioning/lockfile-provision';
import { DatabaseEngineClient, DatabaseEngineOutcome } from './database-engine-client';

/**
 * The SQLite engine plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/sqlite-engine');

/**
 * The per-test timeout: the plugin is a real process, and so is each session's query runner.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * Unwraps an outcome the test expects to have succeeded.
 * @param outcome The outcome.
 * @returns Returns its result.
 */
function resultOf<T>(outcome: DatabaseEngineOutcome<T>): T {
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return outcome.result;
}

/**
 * The contract between core and the SQLite engine plugin (#1095), tested across the real process
 * boundary: the plugin is bundled as its build does, spawned under Node, and spoken to by core's own
 * client. Each side has specs of its own; this is the one place they meet.
 */
describe('SQLite engine plugin contract', () => {
  let scratch: string;
  let file: string;
  let client: DatabaseEngineClient;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-plugin-contract-')));
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
    file = path.join(scratch, 'shop.db');
    const database: DatabaseSync = new DatabaseSync(file);
    database.exec(
      'create table customers (id integer primary key, name text not null);' +
        "insert into customers (name) values ('Ada'), ('Grace'), ('Edsger');",
    );
    database.close();
    client = new DatabaseEngineClient('sqlite', { command: process.execPath, args: [bundle] });
  });

  afterAll(() => {
    client?.dispose();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Connects to the scratch database.
   * @returns Returns the plugin's session id.
   */
  async function connect(): Promise<string> {
    const outcome: ConnectOutcome = resultOf(await client.call('connect', { values: { file } }));
    if (outcome.kind !== 'connected') {
      throw new Error(`Not connected: ${JSON.stringify(outcome)}`);
    }
    return outcome.session;
  }

  it('describesItselfAsTheManifestDoes', TIMEOUT, async () => {
    const parsed: { manifest: PluginManifest | null } = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const info: DatabaseEngineInfo | null = await client.info();

    expect(parsed.manifest).not.toBeNull();
    expect(info?.id).toBe(parsed.manifest?.contributes.databaseEngines?.[0]?.id);
    expect(info?.capabilities).toEqual(expect.arrayContaining(['cancel', 'script']));
  });

  it('browsesAndQueriesOverTheWire', TIMEOUT, async () => {
    const session: string = await connect();
    const top: ExpandOutcome = resultOf(await client.call('expand', { session, path: null }));
    const outcome: ExecuteOutcome = resultOf(
      await client.call('execute', {
        id: 'contract-select',
        session,
        text: 'select name from customers order by id;',
        firstLine: 1,
      }),
    );

    expect(
      top.kind === 'nodes' && top.nodes.map((node: DatabaseNode): string => node.label),
    ).toEqual(['main']);
    expect(outcome.failed).toBe(false);
    expect(outcome.resultSets[0].rows).toEqual([['Ada'], ['Grace'], ['Edsger']]);
  });

  it('answersADatabaseErrorAsAnOutcome_onTheLineItHappened', TIMEOUT, async () => {
    const session: string = await connect();
    const outcome: ExecuteOutcome = resultOf(
      await client.call('execute', {
        id: 'contract-error',
        session,
        text: 'select 1;\nselect * from nowhere;',
        firstLine: 1,
      }),
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.messages).toContainEqual(
      expect.objectContaining({ severity: 'error', line: 2 }),
    );
  });

  it('cancelsALongQuery_andTheSessionStaysUsable', TIMEOUT, async () => {
    const session: string = await connect();
    const running: Promise<DatabaseEngineOutcome<ExecuteOutcome>> = client.call('execute', {
      id: 'contract-long',
      session,
      text:
        'with recursive c(x) as (select 1 union all select x + 1 from c) ' +
        'select count(*) from c where x < 1000000000;',
      firstLine: 1,
    });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 300);
    });
    await client.call('cancel', { id: 'contract-long' });
    const cancelled: ExecuteOutcome = resultOf(await running);
    const after: ExecuteOutcome = resultOf(
      await client.call('execute', {
        id: 'contract-after',
        session,
        text: 'select count(*) from customers;',
        firstLine: 1,
      }),
    );

    expect(cancelled.cancelled).toBe(true);
    expect(after.resultSets[0].rows).toEqual([[3]]);
  });
});

/**
 * The SQLite engine plugin is installable: everything a release depends on agrees before a tag is
 * spent, the same claims the other first-party plugins' contracts make of theirs.
 */
describe('the SQLite engine plugin is installable', () => {
  const manifestText: string = fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8');
  const manifest: PluginManifest = parsePluginManifest(JSON.parse(manifestText)).manifest!;
  const lockfilePath: string = path.resolve(
    'src/shared/electron/contributions/plugins/lockfiles/sqlite-engine.lock.json',
  );
  const lockfileText: string = fs.readFileSync(lockfilePath, 'utf8');
  const packages: readonly LockfilePackage[] = parseLockfileDocument(JSON.parse(lockfileText))!;
  const pkg: { name: string; version: string } = JSON.parse(
    fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'),
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
        'src/shared/electron/contributions/plugins/lockfiles/sqlite-engine.lock.json',
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
        `plugin-sqlite-engine-v${pkg.version}/onixlabs-sqlite-engine-${pkg.version}.tgz`,
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
    const declared: string = /DATABASE_ENGINE_PROTOCOL: string = '([^']+)'/.exec(source)?.[1] ?? '';

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
      index.plugins.find((plugin: { id: string }): boolean => plugin.id === manifest.id),
    ).toEqual(JSON.parse(manifestText));
  });
});
