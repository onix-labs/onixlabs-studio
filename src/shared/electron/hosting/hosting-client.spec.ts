import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HostingDescription, HostingResponse } from '@shared/api/hosting-protocol';
import { HostingClient } from './hosting-client';
import { HostingSpec } from './hosting-descriptor';
import { HostingCredentialSource } from './hosting-endpoint';

/**
 * Holds the directory the stub plugins are written into.
 */
let directory: string;

/**
 * Holds the clients started by a test, stopped after it.
 */
const clients: HostingClient[] = [];

beforeAll((): void => {
  directory = mkdtempSync(join(tmpdir(), 'hosting-client-'));
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
 * The prelude every stub shares: reads lines and hands each parsed message to `answer`.
 */
const PRELUDE: string = `
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
const reply = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
`;

/**
 * Writes a stub plugin and returns a client for it. A real child process rather than a mocked stream:
 * framing, correlation, the credential round-trip and exit handling are the parts worth testing.
 * @param name The script name.
 * @param body The script body, run after {@link PRELUDE}.
 * @param credentials Where credential requests are answered from.
 * @returns Returns the client, not yet started.
 */
function stub(
  name: string,
  body: string,
  credentials: HostingCredentialSource = (): Promise<string | null> => Promise.resolve(null),
): HostingClient {
  const file: string = join(directory, `${name}.cjs`);
  writeFileSync(file, `${PRELUDE}\n${body}`, 'utf8');
  const spec: HostingSpec = { command: process.execPath, args: [file] };
  const client: HostingClient = new HostingClient(name, spec, credentials);
  clients.push(client);
  return client;
}

/**
 * A stub that initializes as protocol 1.0, echoes the auth choices it was given as its capabilities'
 * companion, answers `authStatus` by first asking Studio for the host's credential, and fails
 * `listIssues` as rate-limited.
 */
const WELL_BEHAVED: string = `
const waiting = new Map();
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.answer === 'credential') {
    const request = waiting.get(message.callId);
    waiting.delete(message.callId);
    reply({ id: request.id, ok: true, result: {
      authenticated: message.token !== null, mode: 'studio', identity: null,
      detail: message.token === null ? 'no token' : 'token ' + message.token } });
    return;
  }
  if (message.op === 'initialize') {
    reply({ id: message.id, ok: true, result: {
      protocol: '1.0', capabilities: ['issues', 'ciRuns', 'teleport'], auth: message.params.auth } });
  } else if (message.op === 'authStatus') {
    const callId = 100 + message.id;
    waiting.set(callId, message);
    reply({ request: 'credential', callId, host: message.params.host });
  } else if (message.op === 'listIssues') {
    reply({ id: message.id, ok: false, error: 'slow down', code: 'rate-limited',
      retryAt: '2026-10-05T12:00:00Z' });
  }
});
`;

describe('HostingClient', () => {
  it('start_whenTheHandshakeIsCompatible_returnsTheDescriptionWithKnownCapabilitiesOnly', async () => {
    const client: HostingClient = stub('well-behaved', WELL_BEHAVED);

    const description: HostingDescription | null = await client.start({ 'github.com': 'cli' });

    expect(description?.protocol).toBe('1.0');
    // An unknown capability is dropped rather than refusing the plugin.
    expect(description?.capabilities).toEqual(['issues', 'ciRuns']);
    expect(client.running).toBe(true);
  });

  it('start_whenTheProtocolIsIncompatible_refusesThePlugin', async () => {
    const client: HostingClient = stub(
      'future',
      `lines.on('line', (line) => {
        const message = JSON.parse(line);
        reply({ id: message.id, ok: true, result: { protocol: '2.0', capabilities: [] } });
      });`,
    );

    expect(await client.start({})).toBeNull();
    expect(client.running).toBe(false);
  });

  it('request_whenThePluginAsksForACredential_answersItFromTheSource_andCompletesTheRequest', async () => {
    const asked: string[] = [];
    const client: HostingClient = stub('credential', WELL_BEHAVED, (host: string) => {
      asked.push(host);
      return Promise.resolve('secret-token');
    });
    await client.start({});

    const response: HostingResponse<'authStatus'> = await client.request(
      'authStatus',
      { host: 'github.com' },
      5_000,
    );

    expect(asked).toEqual(['github.com']);
    expect(response.ok && response.result.detail).toBe('token secret-token');
  });

  it('request_whenTheSourceHasNoCredential_answersNull_ratherThanLeavingThePluginWaiting', async () => {
    const client: HostingClient = stub('no-credential', WELL_BEHAVED, () => Promise.resolve(null));
    await client.start({});

    const response: HostingResponse<'authStatus'> = await client.request(
      'authStatus',
      { host: 'github.com' },
      5_000,
    );

    expect(response.ok && response.result.authenticated).toBe(false);
  });

  it('request_whenTheSourceThrows_answersNull', async () => {
    const client: HostingClient = stub('throwing', WELL_BEHAVED, () =>
      Promise.reject(new Error('keychain locked')),
    );
    await client.start({});

    const response: HostingResponse<'authStatus'> = await client.request(
      'authStatus',
      { host: 'github.com' },
      5_000,
    );

    expect(response.ok && response.result.detail).toBe('no token');
  });

  it('request_carriesAFailuresCodeAndRetryTime', async () => {
    const client: HostingClient = stub('rate-limited', WELL_BEHAVED);
    await client.start({});

    const response: HostingResponse<'listIssues'> = await client.request(
      'listIssues',
      { repository: { host: 'github.com', owner: 'o', name: 'n' } },
      5_000,
    );

    expect(response).toMatchObject({
      ok: false,
      code: 'rate-limited',
      retryAt: '2026-10-05T12:00:00Z',
    });
  });

  it('request_whenThePluginDoesNotAnswer_failsAfterTheTimeout', async () => {
    const client: HostingClient = stub('silent', WELL_BEHAVED);
    await client.start({});

    const response: HostingResponse<'listCiRuns'> = await client.request(
      'listCiRuns',
      { repository: { host: 'github.com', owner: 'o', name: 'n' } },
      200,
    );

    expect(response).toMatchObject({ ok: false, error: 'silent did not answer in time.' });
  });

  it('request_whenThePluginExits_failsWhatIsInFlight', async () => {
    const client: HostingClient = stub(
      'dies',
      `lines.on('line', (line) => {
        const message = JSON.parse(line);
        if (message.op === 'initialize') {
          reply({ id: message.id, ok: true, result: { protocol: '1.0', capabilities: [] } });
        } else {
          process.exit(3);
        }
      });`,
    );
    await client.start({});

    const response: HostingResponse<'listAccounts'> = await client.request(
      'listAccounts',
      { host: 'github.com' },
      5_000,
    );

    expect(response).toMatchObject({ ok: false, error: 'dies exited.' });
    expect(client.running).toBe(false);
  });

  it('request_beforeStart_failsWithoutSpawning', async () => {
    const client: HostingClient = stub('unstarted', WELL_BEHAVED);

    const response: HostingResponse<'listAccounts'> = await client.request(
      'listAccounts',
      { host: 'github.com' },
      5_000,
    );

    expect(response).toMatchObject({ ok: false, error: 'unstarted is not running.' });
  });
});
