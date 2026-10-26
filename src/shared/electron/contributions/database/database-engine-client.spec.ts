import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectOutcome,
  DatabaseEngineInfo,
  ExecuteOutcome,
  ExpandOutcome,
} from '@shared/api/database-engine-protocol';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: (): string => tmpdir() } }));

const { DatabaseEngineClient, readDescription } = await import('./database-engine-client');

type Client = InstanceType<typeof DatabaseEngineClient>;

/**
 * How a fake plugin answers the handshake.
 */
type Handshake = 'ok' | 'incompatible' | 'malformed';

/**
 * The engine the fake plugin describes.
 */
const ENGINE: DatabaseEngineInfo = {
  id: 'fake',
  displayName: 'Fake',
  language: 'sql',
  queryExtension: 'sql',
  capabilities: ['cancel'],
  connectionFields: [],
};

/**
 * A fake engine plugin: answers the protocol from a script, so the client is driven through a real
 * process and real pipes. `connect` names the process and how many handshakes it has had; an
 * `execute` of `slow` answers late, so a quicker request overtakes it; `expand` fails; `fetch` writes
 * noise and splits its answer across two writes; `disconnect` exits mid-request, as a crashed plugin
 * would; `cancel` is never answered.
 * @param handshake How it answers `initialize`.
 * @returns Returns the script.
 */
function fakePlugin(handshake: Handshake): string {
  const description: unknown =
    handshake === 'ok'
      ? { protocol: '1.0', engine: ENGINE }
      : handshake === 'incompatible'
        ? { protocol: '2.0', engine: ENGINE }
        : { protocol: '1.0', engine: { id: 'fake' } };
  return `
const readline = require('node:readline');
let handshakes = 0;
const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const answer = (result) => write({ id: request.id, ok: true, result });
  switch (request.op) {
    case 'initialize':
      handshakes += 1;
      return answer(${JSON.stringify(description)});
    case 'connect':
      return answer({ kind: 'connected', session: 's1', serverVersion: process.pid + ':' + handshakes });
    case 'execute':
      if (request.params.text === 'slow') {
        return setTimeout(() => answer({ id: request.params.id, resultSets: [], messages: [], elapsedMs: 1, failed: false, cancelled: false }), 300);
      }
      return answer({ id: request.params.id, resultSets: [], messages: [], elapsedMs: 0, failed: false, cancelled: false });
    case 'expand':
      return request.params.path === 'bare'
        ? write({ id: request.id, ok: false })
        : write({ id: request.id, ok: false, error: 'boom' });
    case 'fetch': {
      process.stdout.write('not json\\n');
      write({ id: 999999, ok: true, result: 'nobody asked' });
      const text = JSON.stringify({ id: request.id, ok: true, result: [[1], [2]] }) + '\\n';
      process.stdout.write(text.slice(0, 5));
      return setTimeout(() => process.stdout.write(text.slice(5)), 20);
    }
    case 'disconnect':
      return process.exit(1);
    case 'cancel':
      return;
    default:
      return write({ id: request.id, ok: false, error: 'unknown' });
  }
});
`;
}

describe('DatabaseEngineClient', () => {
  let directory: string;
  let clients: Client[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'database-engine-client-'));
    clients = [];
  });

  afterEach(() => {
    for (const client of clients) {
      client.dispose();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Builds a client over a fake plugin.
   * @param handshake How the plugin answers the handshake.
   * @returns Returns the client.
   */
  function clientFor(handshake: Handshake = 'ok'): Client {
    const script: string = join(directory, `plugin-${clients.length}.js`);
    writeFileSync(script, fakePlugin(handshake), 'utf8');
    const client: Client = new DatabaseEngineClient('fake', {
      command: process.execPath,
      args: [script],
    });
    clients.push(client);
    return client;
  }

  /**
   * Connects, answering the server version the fake reports: its process id and handshake count.
   * @param client The client.
   * @returns Returns the version.
   */
  async function serverOf(client: Client): Promise<string> {
    const outcome: { ok: boolean; result?: ConnectOutcome } = await client.call('connect', {
      values: {},
    });
    expect(outcome.ok).toBe(true);
    return outcome.result?.kind === 'connected' ? outcome.result.serverVersion : '';
  }

  /**
   * Sends a request the client would not, with a timeout of the test's choosing.
   * @param client The client.
   * @param op The operation.
   * @param ms The timeout.
   * @returns Returns the outcome.
   */
  function sendRaw(
    client: Client,
    op: string,
    ms: number,
  ): Promise<{ ok: boolean; error?: string }> {
    return (
      client as unknown as {
        send(op: string, params: unknown, ms: number): Promise<{ ok: boolean; error?: string }>;
      }
    ).send(op, {}, ms);
  }

  it('info_startsThePluginOnFirstUse_andAnswersWhatItSaysAboutItself', async () => {
    const client: Client = clientFor();

    expect(await client.info()).toEqual(ENGINE);
    expect(await client.call('connect', { values: {} })).toMatchObject({
      ok: true,
      result: { kind: 'connected', session: 's1' },
    });
  });

  it('sharesOneStartBetweenConcurrentCallers', async () => {
    const client: Client = clientFor();

    const [first, second] = await Promise.all([serverOf(client), serverOf(client)]);

    expect(first).toBe(second);
    expect(first.endsWith(':1')).toBe(true);
  });

  it('call_matchesEachAnswerToItsRequest_inWhateverOrderTheyCome', async () => {
    const client: Client = clientFor();
    await client.info();
    const order: string[] = [];

    const slow: Promise<unknown> = client
      .call('execute', { id: 'slow-run', session: 's1', text: 'slow', firstLine: 1 })
      .then((outcome: { ok: boolean; result?: ExecuteOutcome }): void => {
        order.push(outcome.result?.id ?? 'none');
      });
    const quick: Promise<unknown> = client
      .call('execute', { id: 'quick-run', session: 's1', text: 'quick', firstLine: 1 })
      .then((outcome: { ok: boolean; result?: ExecuteOutcome }): void => {
        order.push(outcome.result?.id ?? 'none');
      });
    await Promise.all([slow, quick]);

    expect(order).toEqual(['quick-run', 'slow-run']);
  });

  it('call_answersAnErrorAnswerAsAFailedOutcome', async () => {
    const client: Client = clientFor();

    expect(await client.call('expand', { session: 's1', path: null })).toEqual({
      ok: false,
      error: 'boom',
    });
    // An error answer that says nothing about why still fails rather than passing as a result.
    const bare: { ok: boolean; result?: ExpandOutcome; error?: string } = await client.call(
      'expand',
      { session: 's1', path: 'bare' },
    );
    expect(bare).toEqual({ ok: false, error: 'failed' });
  });

  it('call_readsAnAnswerSplitAcrossWrites_ignoringNoiseAndAnswersNobodyAskedFor', async () => {
    const client: Client = clientFor();

    expect(
      await client.call('fetch', { session: 's1', resultSet: 'r', offset: 0, count: 2 }),
    ).toEqual({ ok: true, result: [[1], [2]] });
  });

  it('send_answersATimeout_whenThePluginDoesNotAnswerInTime', async () => {
    const client: Client = clientFor();
    await client.info();

    expect(await sendRaw(client, 'cancel', 50)).toEqual({
      ok: false,
      error: 'The fake engine did not answer in time.',
    });
    // A late or missing answer costs that request only.
    expect(await serverOf(client)).not.toBe('');
  });

  it('failsWhatWasWaiting_whenThePluginExits_toldListeners_andStartsItAgain', async () => {
    const client: Client = clientFor();
    const before: string = await serverOf(client);
    const exits: string[] = [];
    client.onExit((): number => exits.push('exit'));
    const unregistered: () => void = client.onExit((): number => exits.push('removed'));
    unregistered();

    // The fake exits on disconnect, as a crashed plugin would.
    expect(await client.call('disconnect', { session: 's1' })).toEqual({
      ok: false,
      error: 'The fake engine stopped.',
    });
    expect(exits).toEqual(['exit']);

    const after: string = await serverOf(client);
    expect(after).not.toBe(before);
    expect(after.endsWith(':1')).toBe(true);
  });

  it('restart_stopsTheProcess_failingWhatWasWaiting_andTheNextCallStartsAfresh', async () => {
    const client: Client = clientFor();
    const before: string = await serverOf(client);
    let exits: number = 0;
    client.onExit((): void => {
      exits += 1;
    });

    const waiting: Promise<{ ok: boolean; error?: string }> = sendRaw(client, 'cancel', 10_000);
    client.restart();

    expect(await waiting).toEqual({ ok: false, error: 'The fake engine was stopped.' });
    expect(exits).toBe(1);
    expect(await serverOf(client)).not.toBe(before);
  });

  it('dispose_stopsThePluginForGood', async () => {
    const client: Client = clientFor();
    await client.info();

    client.dispose();

    expect(await client.info()).toBeNull();
    expect(await client.call('connect', { values: {} })).toEqual({
      ok: false,
      error: 'The fake engine could not be started.',
    });
  });

  it('refusesAPluginSpeakingAnotherMajorProtocol', async () => {
    const client: Client = clientFor('incompatible');

    expect(await client.info()).toBeNull();
    expect(await client.call('connect', { values: {} })).toEqual({
      ok: false,
      error: 'The fake engine could not be started.',
    });
  });

  it('refusesAPluginWhoseHandshakeIsNotADescription', async () => {
    expect(await clientFor('malformed').info()).toBeNull();
  });

  it('answersSafelyWhenThePluginCannotStart', async () => {
    const client: Client = new DatabaseEngineClient('missing', {
      command: join(directory, 'no-such-program'),
      args: [],
    });
    clients.push(client);

    expect(await client.info()).toBeNull();
    expect(await client.call('connect', { values: {} })).toEqual({
      ok: false,
      error: 'The missing engine could not be started.',
    });
  });
});

describe('readDescription', () => {
  it('keepsAnEngineStudioCanUse_andRefusesWhatIsNotADescription', () => {
    expect(readDescription({ protocol: '1.0', engine: ENGINE })).toEqual({
      protocol: '1.0',
      engine: ENGINE,
    });
    expect(readDescription({ engine: ENGINE })).toBeNull();
    expect(readDescription({ protocol: '1.0' })).toBeNull();
    expect(readDescription({ protocol: '1.0', engine: { ...ENGINE, language: 3 } })).toBeNull();
    expect(
      readDescription({ protocol: '1.0', engine: { ...ENGINE, connectionFields: undefined } }),
    ).toBeNull();
    expect(readDescription('nope')).toBeNull();
    expect(readDescription(null)).toBeNull();
  });
});
