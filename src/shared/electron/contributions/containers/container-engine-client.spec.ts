import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerEvent, ImagePullProgress } from '@shared/api/container-types';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: (): string => tmpdir() } }));

const { ContainerEngineClient, readDescription } = await import('./container-engine-client');

/**
 * A fake engine plugin: answers the protocol from a script, so the client is driven through a real
 * process and real pipes. `listContainers` names the socket it was given; `crash` exits mid-session;
 * `watchStart` sends one event at once.
 * @param capabilities The capabilities it declares.
 * @returns Returns the script.
 */
function fakePlugin(capabilities: readonly string[]): string {
  return `
const readline = require('node:readline');
let socket = '';
const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const answer = (result) => write({ id: request.id, ok: true, result });
  switch (request.op) {
    case 'initialize':
      socket = request.params.socketPath;
      return answer({ protocol: '1.4', capabilities: ${JSON.stringify(capabilities)} });
    case 'status':
      return answer({ available: true, version: '27.0.0' });
    case 'listContainers':
      return answer([{ id: 'c1', names: [socket], image: 'nginx', state: 'running', status: 'Up' }]);
    case 'start':
      return answer(request.params.id === 'c1');
    case 'logs':
      return answer({ lines: ['one', 'two'], truncated: false });
    case 'watchStart':
      answer(true);
      return write({ type: 'event', event: { type: 'container', action: 'start', id: 'c1' } });
    case 'watchStop':
      return answer(true);
    case 'stats':
      return answer(request.params.ids.map((id) => ({ id, cpuPercent: 1.5, memoryBytes: 10, memoryLimitBytes: 100 })));
    case 'pullImage':
      write({ type: 'pull', progress: { reference: request.params.reference, status: 'Downloading', current: 1, total: 2, done: false } });
      write({ type: 'pull', progress: { reference: 'someone-else', status: 'Downloading', done: false } });
      return answer({ ok: true });
    case 'run':
      return answer(request.params.request.image === 'missing' ? { error: 'Pull it first.' } : { id: 'new' });
    case 'crash':
      return process.exit(1);
    default:
      return write({ id: request.id, ok: false, error: 'unknown' });
  }
});
`;
}

describe('ContainerEngineClient', () => {
  let directory: string;
  let clients: InstanceType<typeof ContainerEngineClient>[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'engine-client-'));
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
   * @param capabilities The capabilities the plugin declares.
   * @returns Returns the client.
   */
  function clientFor(
    capabilities: readonly string[] = ['containers', 'images', 'lifecycle', 'logs', 'events'],
  ): InstanceType<typeof ContainerEngineClient> {
    const script: string = join(directory, `plugin-${clients.length}.js`);
    writeFileSync(script, fakePlugin(capabilities), 'utf8');
    const client: InstanceType<typeof ContainerEngineClient> = new ContainerEngineClient(
      'fake',
      { command: process.execPath, args: [script] },
      '/run/fake.sock',
    );
    clients.push(client);
    return client;
  }

  it('startsThePluginOnFirstUse_andHandsItTheSocket', async () => {
    const client: InstanceType<typeof ContainerEngineClient> = clientFor();

    expect(await client.status()).toEqual({ available: true, version: '27.0.0' });
    expect((await client.listContainers())[0].names).toEqual(['/run/fake.sock']);
    expect(await client.start('c1')).toBe(true);
    expect(await client.logs('c1', 10)).toEqual({ lines: ['one', 'two'], truncated: false });
  });

  it('asksOnlyForWhatThePluginSaidItCanDo', async () => {
    const client: InstanceType<typeof ContainerEngineClient> = clientFor(['containers']);

    expect(await client.start('c1')).toBe(false);
    expect(await client.logs('c1', 10)).toEqual({ lines: [], truncated: false });
    expect(await client.listContainers()).toHaveLength(1);
  });

  it('deliversEventsWhileWatched', async () => {
    const client: InstanceType<typeof ContainerEngineClient> = clientFor();
    const events: ContainerEvent[] = [];

    const handle: { close(): void } = client.watch((event: ContainerEvent): number =>
      events.push(event),
    );
    await vi.waitFor((): void => {
      expect(events).toEqual([{ type: 'container', action: 'start', id: 'c1' }]);
    });
    handle.close();
  });

  it('startsThePluginAgainAfterItExits', async () => {
    const client: InstanceType<typeof ContainerEngineClient> = clientFor();
    expect((await client.status()).available).toBe(true);

    // Not an operation Studio sends; the fake exits on it, as a crashed plugin would.
    await (
      client as unknown as { send(op: string, params: unknown, ms: number): Promise<unknown> }
    ).send('crash', {}, 2_000);

    await vi.waitFor(async (): Promise<void> => {
      expect((await client.status()).available).toBe(true);
    });
  });

  it('routesAPullsProgressToItsCaller_andAnswersOnceItIsDone', async () => {
    // #974.
    const client: InstanceType<typeof ContainerEngineClient> = clientFor([
      'containers',
      'imagePull',
    ]);
    const progress: ImagePullProgress[] = [];

    expect(
      await client.pullImage('postgres:16', (update: ImagePullProgress): number =>
        progress.push(update),
      ),
    ).toEqual({ ok: true });
    expect(progress).toEqual([
      { reference: 'postgres:16', status: 'Downloading', current: 1, total: 2, done: false },
    ]);
  });

  it('samplesStats_andRunsContainers_whenThePluginOffersThem', async () => {
    const offering: InstanceType<typeof ContainerEngineClient> = clientFor([
      'containers',
      'stats',
      'run',
    ]);
    expect(await offering.stats(['c1'])).toEqual([
      { id: 'c1', cpuPercent: 1.5, memoryBytes: 10, memoryLimitBytes: 100 },
    ]);
    expect(await offering.run({ image: 'postgres:16' })).toEqual({ id: 'new' });
    expect(await offering.run({ image: 'missing' })).toEqual({ error: 'Pull it first.' });

    const older: InstanceType<typeof ContainerEngineClient> = clientFor(['containers']);
    expect(await older.stats(['c1'])).toEqual([]);
    expect(await older.run({ image: 'postgres:16' })).toEqual({
      error: 'The engine plugin cannot run containers.',
    });
  });

  it('answersSafelyWhenThePluginCannotStart', async () => {
    const client: InstanceType<typeof ContainerEngineClient> = new ContainerEngineClient(
      'missing',
      { command: join(directory, 'no-such-program'), args: [] },
      '/run/fake.sock',
    );
    clients.push(client);

    expect(await client.listContainers()).toEqual([]);
    expect(await client.status()).toEqual({ available: false });
  });
});

describe('readDescription', () => {
  it('keepsTheCapabilitiesItKnows_andRefusesWhatIsNotADescription', () => {
    expect(readDescription({ protocol: '1.0', capabilities: ['logs', 'teleport'] })).toEqual({
      protocol: '1.0',
      capabilities: ['logs'],
    });
    expect(readDescription({ capabilities: [] })).toBeNull();
    expect(readDescription('nope')).toBeNull();
  });
});
