import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import {
  VersionControlDescription,
  VersionControlResponse,
} from '@shared/api/version-control-protocol';
import { VersionControlClient } from './version-control-client';

/**
 * The Git plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/git');

/**
 * The per-test timeout: the plugin is a real process driving real git.
 */
const TIMEOUT: { timeout: number } = { timeout: 30_000 };

/**
 * The contract between core and the Git plugin (#817), tested across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to by core's own client.
 * Each side has specs of its own; this is the one place they meet.
 */
describe('Git plugin contract', () => {
  let scratch: string;
  let repo: string;
  let client: VersionControlClient;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-plugin-contract-')));
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
    repo = path.join(scratch, 'repo');
    fs.mkdirSync(repo);
    const git: (...args: string[]) => void = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=Spec', '-c', 'user.email=spec@studio', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    };
    git('init', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-m', 'initial');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    client = new VersionControlClient('onixlabs.git', {
      command: process.execPath,
      args: [bundle],
    });
  });

  afterAll(() => {
    client?.dispose();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('manifest_isValidAndDeclaresWhatTheHandshakeConfirms', TIMEOUT, async () => {
    const parsed: { manifest: PluginManifest | null } = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const declared: readonly string[] =
      parsed.manifest?.contributes.versionControl?.[0]?.capabilities ?? [];
    const description: VersionControlDescription | null = await client.start(null);

    expect(parsed.manifest).not.toBeNull();
    expect(description?.toolVersion).toMatch(/^git version/);
    // A capability declared but not confirmed is one the host would refuse: the two must agree.
    expect([...(description?.capabilities ?? [])].sort()).toEqual([...declared].sort());
  });

  it('answersTypedResultsOverTheWire', TIMEOUT, async () => {
    await client.start(null);
    const status: VersionControlResponse<'status'> = await client.request(
      'status',
      repo,
      {},
      10_000,
    );
    const log: VersionControlResponse<'log'> = await client.request(
      'log',
      repo,
      { limit: 5 },
      10_000,
    );

    expect(status).toMatchObject({
      ok: true,
      result: { branch: 'main', unstaged: [{ path: 'b.txt', untracked: true }] },
    });
    expect(log.ok && log.result.map((commit) => commit.summary)).toEqual(['initial']);
  });

  it('carriesFailuresAndTheirCodesOverTheWire', TIMEOUT, async () => {
    await client.start(null);

    expect(await client.request('checkout', repo, { branch: '--orphan' }, 10_000)).toMatchObject({
      ok: false,
      error: 'Invalid branch name',
    });
    expect(await client.request('operationContinue', repo, {}, 10_000)).toMatchObject({
      ok: false,
      code: 'no-operation',
    });
  });

  it('reportsAMissingGitAsAProblem_ratherThanRefusingToStart', TIMEOUT, async () => {
    const missing: VersionControlClient = new VersionControlClient('onixlabs.git', {
      command: process.execPath,
      args: [path.join(scratch, 'main.js')],
    });
    try {
      const description: VersionControlDescription | null = await missing.start({
        mode: 'custom',
        path: path.join(scratch, 'no-such-git'),
      });

      expect(description?.toolVersion).toBeNull();
      expect(description?.problem).toContain('Git could not be run');
    } finally {
      missing.dispose();
    }
  });
});
