import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  VersionControlDescription,
  VersionControlResponse,
} from '@shared/api/version-control-protocol';
import { VersionControlClient } from './version-control-client';
import { VersionControlSpec } from './version-control-descriptor';

/**
 * Holds the directory the stub plugins are written into.
 */
let directory: string;

/**
 * Holds the clients started by a test, stopped after it.
 */
const clients: VersionControlClient[] = [];

beforeAll((): void => {
  directory = mkdtempSync(join(tmpdir(), 'version-control-client-'));
});

afterEach((): void => {
  for (const client of clients.splice(0)) {
    client.dispose();
  }
});

afterAll((): void => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * The prelude every stub shares: reads requests line by line and hands each to `answer`.
 */
const PRELUDE: string = `
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
const reply = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
`;

/**
 * Writes a stub plugin and returns a client for it.
 *
 * A real child process rather than a mocked stream: framing, correlation and exit handling are the parts
 * worth testing, and a fake handing over whole messages exercises none of them.
 * @param name The script name.
 * @param body The script body, run after {@link PRELUDE}.
 * @returns Returns the client, not yet started.
 */
function stub(name: string, body: string): VersionControlClient {
  const file: string = join(directory, `${name}.cjs`);
  writeFileSync(file, `${PRELUDE}\n${body}`, 'utf8');
  const spec: VersionControlSpec = { command: process.execPath, args: [file] };
  const client: VersionControlClient = new VersionControlClient(name, spec);
  clients.push(client);
  return client;
}

/**
 * A stub that initializes as protocol 1.0 with stash and tags, echoes the executable choice as its tool
 * version, and answers `status` with an empty working tree.
 */
const WELL_BEHAVED: string = `
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.op === 'initialize') {
    const mode = request.params.executable ? request.params.executable.mode : 'default';
    reply({ id: request.id, ok: true, result: {
      protocol: '1.0', capabilities: ['stash', 'tags', 'teleport'], toolVersion: 'stub ' + mode } });
  } else if (request.op === 'status') {
    reply({ id: request.id, ok: true, result: {
      branch: 'main', upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], conflicted: [],
      root: request.root } });
  } else if (request.op === 'merge') {
    reply({ id: request.id, ok: false, error: 'stopped on conflicts', code: 'conflicted' });
  }
});
`;

describe('VersionControlClient', () => {
  it('start_whenTheHandshakeIsCompatible_returnsTheDescriptionWithKnownCapabilitiesOnly', async () => {
    const client: VersionControlClient = stub('well-behaved', WELL_BEHAVED);

    const description: VersionControlDescription | null = await client.start({
      mode: 'installed',
      path: '',
    });

    expect(description).toEqual({
      protocol: '1.0',
      capabilities: ['stash', 'tags'],
      toolVersion: 'stub installed',
    });
    expect(client.running).toBe(true);
  });

  it('request_whenAnswered_returnsTheTypedResultAndCarriesTheRoot', async () => {
    const client: VersionControlClient = stub('status', WELL_BEHAVED);
    await client.start(null);

    const response: VersionControlResponse<'status'> = await client.request(
      'status',
      '/repo',
      {},
      2_000,
    );

    expect(response.ok).toBe(true);
    expect(response.ok && response.result.branch).toBe('main');
    expect(response.ok && (response.result as unknown as { root: string }).root).toBe('/repo');
  });

  it('request_whenThePluginFailsWithACode_passesTheCodeThrough', async () => {
    const client: VersionControlClient = stub('conflict', WELL_BEHAVED);
    await client.start(null);

    const response: VersionControlResponse<'merge'> = await client.request(
      'merge',
      '/repo',
      { branch: 'feature', mode: 'default' },
      2_000,
    );

    expect(response).toMatchObject({ ok: false, code: 'conflicted' });
  });

  it('start_whenTheProtocolMajorDiffers_refusesThePlugin', async () => {
    const client: VersionControlClient = stub(
      'future',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        reply({ id: request.id, ok: true, result: { protocol: '2.0', capabilities: [], toolVersion: null } });
      });`,
    );

    expect(await client.start(null)).toBeNull();
    expect(client.running).toBe(false);
  });

  it('request_whenThePluginNeverAnswers_failsAfterTheTimeout', async () => {
    const client: VersionControlClient = stub(
      'silent',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: { protocol: '1.0', capabilities: [], toolVersion: null } });
        }
      });`,
    );
    await client.start(null);

    const response: VersionControlResponse<'status'> = await client.request(
      'status',
      '/repo',
      {},
      100,
    );

    expect(response).toMatchObject({ ok: false });
    expect(response.ok ? '' : response.error).toContain('did not answer in time');
  });

  it('request_whenThePluginExitsMidRequest_failsWhatWasPending', async () => {
    const client: VersionControlClient = stub(
      'crash',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: { protocol: '1.0', capabilities: [], toolVersion: null } });
        } else {
          process.exit(3);
        }
      });`,
    );
    await client.start(null);

    const response: VersionControlResponse<'status'> = await client.request(
      'status',
      '/repo',
      {},
      2_000,
    );

    expect(response).toMatchObject({ ok: false, error: 'crash exited.' });
    expect(client.running).toBe(false);
  });

  it('request_whenNotStarted_failsWithoutSpawning', async () => {
    const client: VersionControlClient = stub('idle', WELL_BEHAVED);

    expect(await client.request('status', '/repo', {}, 100)).toMatchObject({ ok: false });
  });
});
