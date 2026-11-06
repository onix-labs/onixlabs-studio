import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PackageManagerDescription,
  PackageManagerResponse,
} from '@shared/api/package-manager-protocol';
import { PackageManagerClient, PackageManagerCredentialSource } from './package-manager-client';

/**
 * Holds the directory the stub plugins are written into.
 */
let directory: string;

/**
 * Holds the clients started by a test, stopped after it.
 */
const clients: PackageManagerClient[] = [];

beforeAll((): void => {
  directory = mkdtempSync(join(tmpdir(), 'package-manager-client-'));
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
 * The prelude every stub shares: reads messages line by line and hands each to `lines`.
 */
const PRELUDE: string = `
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
const reply = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
`;

/**
 * Writes a stub plugin and returns a client for it.
 *
 * A real child process rather than a mocked stream: framing, correlation, the credential round-trip and
 * exit handling are the parts worth testing.
 * @param name The script name.
 * @param body The script body, run after {@link PRELUDE}.
 * @param credentials Where credential requests are answered from.
 * @param maxLineLength The longest stdout line the client buffers, or undefined for the default.
 * @returns Returns the client, not yet started.
 */
function stub(
  name: string,
  body: string,
  credentials: PackageManagerCredentialSource = (): Promise<string | null> => Promise.resolve(null),
  maxLineLength?: number,
): PackageManagerClient {
  const file: string = join(directory, `${name}.cjs`);
  writeFileSync(file, `${PRELUDE}\n${body}`, 'utf8');
  const client: PackageManagerClient = new PackageManagerClient(
    name,
    { command: process.execPath, args: [file] },
    credentials,
    maxLineLength,
  );
  clients.push(client);
  return client;
}

/**
 * A stub that initializes as protocol 1.0, answers `load` with an empty model, answers `sources` by
 * first asking Studio for a registry's credential and reporting whether it got one, and fails
 * everything else.
 */
const WELL_BEHAVED: string = `
const waiting = new Map();
let nextCall = 1;
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.answer === 'credential') {
    waiting.get(message.callId)(message.token);
    return;
  }
  if (message.op === 'initialize') {
    reply({ id: message.id, ok: true, result: {
      protocol: '1.0', capabilities: ['sources', 'search', 'teleport'], toolVersion: 'stub 1' } });
  } else if (message.op === 'load') {
    reply({ id: message.id, ok: true, result: { ecosystem: 'npm', root: message.root, projects: [] } });
  } else if (message.op === 'sources') {
    const callId = nextCall++;
    waiting.set(callId, (token) => {
      reply({ id: message.id, ok: true, result: { sources: [{ name: String(token) }] } });
    });
    reply({ request: 'credential', callId, registry: 'https://registry.example' });
  } else {
    reply({ id: message.id, ok: false, error: 'not here' });
  }
});
`;

describe('PackageManagerClient', () => {
  it('start_completesTheHandshakeAndDropsCapabilitiesItDoesNotKnow', async () => {
    const client: PackageManagerClient = stub('handshake', WELL_BEHAVED);

    const description: PackageManagerDescription | null = await client.start();

    expect(description).toEqual({
      protocol: '1.0',
      capabilities: ['sources', 'search'],
      toolVersion: 'stub 1',
    });
    expect(client.running).toBe(true);
  });

  it('start_refusesAPluginSpeakingAnotherMajorVersion', async () => {
    const client: PackageManagerClient = stub(
      'wrong-major',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        reply({ id: request.id, ok: true, result: { protocol: '2.0', capabilities: [] } });
      });`,
    );

    await expect(client.start()).resolves.toBeNull();
    expect(client.running).toBe(false);
  });

  it('start_refusesAnAnswerThatIsNotADescription', async () => {
    const client: PackageManagerClient = stub(
      'malformed',
      `lines.on('line', (line) => {
        reply({ id: JSON.parse(line).id, ok: true, result: { hello: true } });
      });`,
    );

    await expect(client.start()).resolves.toBeNull();
  });

  it('start_isNullForAProgramThatCannotBeSpawned', async () => {
    const client: PackageManagerClient = new PackageManagerClient(
      'missing',
      { command: join(directory, 'no-such-program'), args: [] },
      (): Promise<string | null> => Promise.resolve(null),
    );
    clients.push(client);

    await expect(client.start()).resolves.toBeNull();
  });

  it('request_carriesTheRootAndReturnsTheAnswer', async () => {
    const client: PackageManagerClient = stub('load', WELL_BEHAVED);
    await client.start();

    const response: PackageManagerResponse<'load'> = await client.request(
      'load',
      '/workspace',
      {},
      5_000,
    );

    expect(response).toMatchObject({ ok: true, result: { root: '/workspace', projects: [] } });
  });

  it('request_returnsThePluginsFailure', async () => {
    const client: PackageManagerClient = stub('failure', WELL_BEHAVED);
    await client.start();

    await expect(
      client.request(
        'search',
        '/workspace',
        { source: 's', query: 'q', skip: 0, take: 1, prerelease: false },
        5_000,
      ),
    ).resolves.toMatchObject({ ok: false, error: 'not here' });
  });

  it('request_failsWhenThePluginIsNotRunning', async () => {
    const client: PackageManagerClient = stub('idle', WELL_BEHAVED);

    await expect(client.request('load', '/workspace', {}, 5_000)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('request_failsWhenThePluginDoesNotAnswerInTime', async () => {
    const client: PackageManagerClient = stub(
      'slow',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: { protocol: '1.0', capabilities: [] } });
        }
      });`,
    );
    await client.start();

    await expect(client.request('load', '/workspace', {}, 50)).resolves.toMatchObject({
      ok: false,
      error: 'slow did not answer in time.',
    });
  });

  it('request_failsWhenThePluginExits', async () => {
    const client: PackageManagerClient = stub(
      'dies',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: { protocol: '1.0', capabilities: [] } });
        } else {
          process.exit(3);
        }
      });`,
    );
    await client.start();

    await expect(client.request('load', '/workspace', {}, 5_000)).resolves.toMatchObject({
      ok: false,
      error: 'dies exited.',
    });
    expect(client.running).toBe(false);
  });

  it('request_failsWhenAnAnswerIsTooLargeToRead', async () => {
    const client: PackageManagerClient = stub(
      'oversized',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: { protocol: '1.0', capabilities: [] } });
        } else {
          process.stdout.write('{"id":' + request.id + ',"ok":true,"result":"' + 'x'.repeat(3000));
          setTimeout(() => process.stdout.write('x'.repeat(3000) + '"}\\n'), 50);
        }
      });`,
      undefined,
      1_000,
    );
    await client.start();

    await expect(client.request('load', '/workspace', {}, 5_000)).resolves.toMatchObject({
      ok: false,
      error: 'oversized sent an answer too large to read.',
    });
  });

  it('credential_isHandedOverMidRequest', async () => {
    const asked: string[] = [];
    const client: PackageManagerClient = stub('credential', WELL_BEHAVED, (registry: string) => {
      asked.push(registry);
      return Promise.resolve('secret-token');
    });
    await client.start();

    const response: PackageManagerResponse<'sources'> = await client.request(
      'sources',
      '/workspace',
      {},
      5_000,
    );

    expect(asked).toEqual(['https://registry.example']);
    expect(response).toMatchObject({ ok: true, result: { sources: [{ name: 'secret-token' }] } });
  });

  it('credential_answersNullWhenThereIsNone', async () => {
    const client: PackageManagerClient = stub('no-credential', WELL_BEHAVED);
    await client.start();

    await expect(client.request('sources', '/workspace', {}, 5_000)).resolves.toMatchObject({
      result: { sources: [{ name: 'null' }] },
    });
  });

  it('credential_answersNullWhenReadingItFails', async () => {
    const client: PackageManagerClient = stub('credential-fails', WELL_BEHAVED, () =>
      Promise.reject(new Error('locked')),
    );
    await client.start();

    await expect(client.request('sources', '/workspace', {}, 5_000)).resolves.toMatchObject({
      result: { sources: [{ name: 'null' }] },
    });
  });

  it('dispose_failsWhatIsInFlightAndStopsThePlugin', async () => {
    const client: PackageManagerClient = stub(
      'stopped',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: { protocol: '1.0', capabilities: [] } });
        }
      });`,
    );
    await client.start();

    const pending: Promise<PackageManagerResponse<'load'>> = client.request(
      'load',
      '/workspace',
      {},
      5_000,
    );
    client.dispose();

    await expect(pending).resolves.toMatchObject({ ok: false, error: 'stopped was stopped.' });
    expect(client.running).toBe(false);
  });

  it('plugin_doesNotInheritSecretsFromTheEnvironment', async () => {
    process.env['STUDIO_TEST_NPM_TOKEN'] = 'must-not-reach-the-plugin';
    const client: PackageManagerClient = stub(
      'environment',
      `lines.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.op === 'initialize') {
          reply({ id: request.id, ok: true, result: {
            protocol: '1.0', capabilities: [],
            toolVersion: String(process.env.STUDIO_TEST_NPM_TOKEN) } });
        }
      });`,
    );

    try {
      await expect(client.start()).resolves.toMatchObject({ toolVersion: 'undefined' });
    } finally {
      delete process.env['STUDIO_TEST_NPM_TOKEN'];
    }
  });
});
