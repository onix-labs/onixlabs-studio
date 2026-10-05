import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  HostingDescription,
  HostingResponse,
  isCompatibleHostingProtocol,
} from '@shared/api/hosting-protocol';
import { parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import { type LockfilePackage, parseLockfileDocument } from '../provisioning/lockfile-provision';
import { HostingClient } from './hosting-client';

/**
 * The GitHub plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/github');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * A repository on github.com.
 */
const REPOSITORY: { host: string; owner: string; name: string } = {
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * The contract between core and the GitHub plugin (#820), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client.
 *
 * Nothing here reaches GitHub. Every case is one the plugin answers before a request would leave the
 * machine — which is also what makes the credential round-trip testable: told to use Studio's login,
 * and handed none, the plugin must ask, hear "none", and say so.
 */
describe('GitHub plugin contract', () => {
  let scratch: string;
  let bundle: string;
  const clients: HostingClient[] = [];

  /**
   * Starts a client for the bundled plugin.
   * @param credentials Where its credential requests are answered from.
   * @returns Returns the client, not yet started.
   */
  function client(credentials: (host: string) => Promise<string | null>): HostingClient {
    const started: HostingClient = new HostingClient(
      'onixlabs.github',
      { command: process.execPath, args: [bundle] },
      credentials,
    );
    clients.push(started);
    return started;
  }

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'github-plugin-contract-')));
    bundle = path.join(scratch, 'main.js');
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
  });

  afterEach(() => {
    for (const started of clients.splice(0)) {
      started.dispose();
    }
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('manifest_isValidAndDeclaresWhatTheHandshakeConfirms', TIMEOUT, async () => {
    const parsed: { manifest: PluginManifest | null } = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const declared: readonly string[] =
      parsed.manifest?.contributes.hosting?.[0]?.capabilities ?? [];
    const description: HostingDescription | null = await client(() => Promise.resolve(null)).start(
      {},
    );

    expect(parsed.manifest).not.toBeNull();
    // A capability declared but not confirmed is one the host would refuse: the two must agree.
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it('asksStudioForTheCredential_whenTheUserChoseStudiosLogin', TIMEOUT, async () => {
    const asked: string[] = [];
    const github: HostingClient = client((host: string) => {
      asked.push(host);
      return Promise.resolve(null);
    });
    await github.start({ 'github.com': 'studio' });

    const issues: HostingResponse<'listIssues'> = await github.request(
      'listIssues',
      { repository: REPOSITORY },
      10_000,
    );

    // Handed nothing, it says so — without a request leaving the machine.
    expect(asked).toEqual(['github.com']);
    expect(issues).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('reportsNotSignedIn_overTheWire', TIMEOUT, async () => {
    const github: HostingClient = client(() => Promise.resolve(null));
    await github.start({ 'github.com': 'studio' });

    const status: HostingResponse<'authStatus'> = await github.request(
      'authStatus',
      { host: 'github.com' },
      10_000,
    );

    expect(status).toMatchObject({ ok: true, result: { authenticated: false, mode: null } });
  });

  it('refusesARequestWithoutTheParametersItNeeds', TIMEOUT, async () => {
    const github: HostingClient = client(() => Promise.resolve(null));
    await github.start({});

    const response: HostingResponse = await github.request('listIssues', {} as never, 10_000);

    expect(response).toMatchObject({ ok: false, code: 'refused' });
  });

  it('offersNoAgentToolsYet', TIMEOUT, async () => {
    // How GitHub's tools reach agents is decided with #836.
    const github: HostingClient = client(() => Promise.resolve(null));
    await github.start({});

    expect(await github.request('listAgentTools', {}, 10_000)).toEqual({
      id: expect.any(Number) as number,
      ok: true,
      result: [],
    });
  });
});

/**
 * The GitHub plugin is installable: everything a release depends on agrees before a tag is spent, the
 * same claims the Git plugin's contract makes of its own.
 */
describe('the GitHub plugin is installable', () => {
  const manifestText: string = fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8');
  const manifest: PluginManifest = parsePluginManifest(JSON.parse(manifestText)).manifest!;
  const lockfilePath: string = path.resolve(
    'src/shared/electron/contributions/plugins/lockfiles/onixlabs.github.lock.json',
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
        'src/shared/electron/contributions/plugins/lockfiles/onixlabs.github.lock.json',
    );
  });

  it('namesAnEntryPointTheTreeActuallyDelivers', () => {
    const entryPoint: string = manifest.contributes.hosting![0].entryPoint ?? '';

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
        `plugin-github-v${pkg.version}/onixlabs-github-${pkg.version}.tgz`,
    );
  });

  it('publishesTheVersionTheManifestNames', () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it('speaksAProtocolVersionThisBuildHonours', () => {
    const source: string = fs.readFileSync(path.join(PLUGIN, 'src', 'protocol.ts'), 'utf8');
    const declared: string = /HOSTING_PROTOCOL_VERSION: string = '([^']+)'/.exec(source)?.[1] ?? '';

    expect(isCompatibleHostingProtocol(declared)).toBe(true);
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
