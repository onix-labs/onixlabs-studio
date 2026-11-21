import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  LiveServerDescription,
  LiveServerOp,
  LiveServerParams,
  LiveServerResponse,
} from '@shared/api/live-server-protocol';
import type { LiveServerInfo, LiveServerOpenAnswer } from '@shared/api/live-server-channels';
import {
  LiveServerDescriptor,
  LiveServerResolution,
  LiveServerSpec,
} from './live-server-descriptor';
import { LiveServerEndpoint } from './live-server-endpoint';
import { LIVE_SERVER_FIRST_PORT, LiveServerHost, LiveServerRoots } from './live-server-host';

/**
 * The workspace every test opens.
 */
const ROOT: string = path.resolve('/work/site');

/**
 * A request the fake plugin was sent.
 */
interface SentRequest {
  readonly op: LiveServerOp;
  readonly params: unknown;
}

/**
 * A plugin process that answers as a well-behaved live server does, recording what it was asked.
 */
class FakeEndpoint implements LiveServerEndpoint {
  public readonly sent: SentRequest[] = [];
  public started: number = 0;
  public disposed: boolean = false;
  public serveAnswer: unknown = { serverId: 's1', port: 5501 };
  public startsOk: boolean = true;
  private live: boolean = false;

  public constructor(public readonly onExited: () => void) {}

  public get running(): boolean {
    return this.live;
  }

  public start(): Promise<LiveServerDescription | null> {
    this.started += 1;
    this.live = this.startsOk;
    return Promise.resolve(this.startsOk ? { protocol: '1.0' } : null);
  }

  public request<Op extends LiveServerOp>(
    op: Op,
    params: LiveServerParams<Op>,
  ): Promise<LiveServerResponse<Op>> {
    this.sent.push({ op, params });
    const result: unknown = op === 'serve' ? this.serveAnswer : {};
    return Promise.resolve({ id: 1, ok: true, result } as LiveServerResponse<Op>);
  }

  public dispose(): void {
    this.disposed = true;
    this.live = false;
  }

  public exit(): void {
    this.live = false;
    this.onExited();
  }
}

/**
 * Open workspaces, as the workspace context answers for them.
 */
class FakeRoots implements LiveServerRoots {
  public constructor(public readonly roots: string[]) {}

  public isWithin(target: unknown): boolean {
    return (
      typeof target === 'string' &&
      this.roots.some(
        (root: string): boolean => target === root || target.startsWith(root + path.sep),
      )
    );
  }

  public isRoot(target: string): boolean {
    return this.roots.includes(target);
  }

  public rootContaining(target: string): string | undefined {
    return this.roots.find((root: string): boolean => target.startsWith(root + path.sep));
  }
}

describe('LiveServerHost (#1062)', () => {
  let endpoints: FakeEndpoint[];
  let announced: (readonly LiveServerInfo[])[];
  let descriptors: LiveServerDescriptor[];
  let links: Map<string, string>;
  let serveAnswer: unknown;
  let host: LiveServerHost;

  /**
   * Builds a descriptor for an installed plugin.
   * @param id The plugin id.
   * @param priority Its priority.
   * @returns Returns the descriptor.
   */
  function installed(id: string, priority: number = 100): LiveServerDescriptor {
    return {
      id,
      displayName: 'Live Server',
      priority,
      resolve: (): LiveServerResolution => ({ available: true, spec: { command: id, args: [] } }),
    };
  }

  beforeEach(() => {
    endpoints = [];
    announced = [];
    links = new Map<string, string>();
    serveAnswer = { serverId: 's1', port: 5501 };
    descriptors = [installed('live-server')];
    host = new LiveServerHost({
      descriptors: (): readonly LiveServerDescriptor[] => descriptors,
      roots: new FakeRoots([ROOT]),
      onChanged: (servers: readonly LiveServerInfo[]): void => {
        announced.push(servers);
      },
      realPath: (target: string): Promise<string> => Promise.resolve(links.get(target) ?? target),
      isFile: (): Promise<boolean> => Promise.resolve(true),
      createClient: (
        _id: string,
        _spec: LiveServerSpec,
        onExited: () => void,
      ): LiveServerEndpoint => {
        const endpoint: FakeEndpoint = new FakeEndpoint(onExited);
        endpoint.serveAnswer = serveAnswer;
        endpoints.push(endpoint);
        return endpoint;
      },
    });
  });

  it('serves_theWorkspaceRoot_onTheFirstPortFromTheDefault', async () => {
    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'docs', 'about.html'));

    expect(answer).toEqual({
      ok: true,
      server: { root: ROOT, url: 'http://127.0.0.1:5501/', port: 5501, displayName: 'Live Server' },
      pageUrl: 'http://127.0.0.1:5501/docs/about.html',
    });
    expect(endpoints[0].sent).toEqual([
      { op: 'serve', params: { root: ROOT, port: LIVE_SERVER_FIRST_PORT } },
    ]);
    expect(announced).toHaveLength(1);
  });

  it('opens_anIndexPage_atItsFolder', async () => {
    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'index.html'));

    expect(answer.ok && answer.pageUrl).toBe('http://127.0.0.1:5501/');
  });

  it('encodes_eachSegmentOfThePage', async () => {
    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'a b', 'c#d.html'));

    expect(answer.ok && answer.pageUrl).toBe('http://127.0.0.1:5501/a%20b/c%23d.html');
  });

  it('reuses_theServer_forAnotherPageOfTheSameWorkspace', async () => {
    await host.open(path.join(ROOT, 'index.html'));
    await host.open(path.join(ROOT, 'other.html'));

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].sent.filter((request: SentRequest) => request.op === 'serve')).toHaveLength(
      1,
    );
  });

  it('starts_oneServer_forTwoOpensAtOnce', async () => {
    await Promise.all([
      host.open(path.join(ROOT, 'index.html')),
      host.open(path.join(ROOT, 'other.html')),
    ]);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].sent).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ['not text', 7],
    ['relative', 'site/index.html'],
    ['holding a NUL', `${ROOT}/index.html\0.png`],
    ['not a page', path.join(ROOT, 'style.css')],
    ['outside every workspace', path.resolve('/etc/index.html')],
    ['escaping by dots', `${ROOT}/../secret/index.html`],
  ])('refuses_aPage_%s', async (_name: string, file: unknown) => {
    const answer: LiveServerOpenAnswer = await host.open(file);

    expect(answer.ok).toBe(false);
    expect(endpoints).toHaveLength(0);
  });

  it('refuses_aPage_linkedOutOfItsWorkspace', async () => {
    links.set(path.join(ROOT, 'evil.html'), path.resolve('/etc/evil.html'));

    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'evil.html'));

    expect(answer).toEqual({ ok: false, error: 'The page is outside its workspace.' });
  });

  it('refuses_whenNoPluginIsContributed', async () => {
    descriptors = [];

    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'index.html'));

    expect(answer).toEqual({ ok: false, error: 'No Live Server plugin is installed.' });
    expect(host.availability()).toBe('none');
  });

  it('says_whyAContributedPlugin_cannotStart', async () => {
    descriptors = [
      {
        id: 'live-server',
        displayName: 'Live Server',
        priority: 100,
        resolve: (): LiveServerResolution => ({
          available: false,
          reason: 'Live Server is not installed.',
        }),
      },
    ];

    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'index.html'));

    expect(answer).toEqual({ ok: false, error: 'Live Server is not installed.' });
    expect(host.availability()).toBe('not-installed');
  });

  it('prefers_theInstalledPlugin_withTheHighestPriority', async () => {
    descriptors = [installed('low', 10), installed('high', 200)];

    await host.open(path.join(ROOT, 'index.html'));

    expect(host.availability()).toBe('ready');
    expect(endpoints).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ['no port', { serverId: 's1' }],
    ['a port out of range', { serverId: 's1', port: 70_000 }],
    ['no server id', { port: 5500 }],
  ])('disbelieves_aServeAnswerWith_%s', async (_name: string, answered: unknown) => {
    serveAnswer = answered;

    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'index.html'));

    expect(answer.ok).toBe(false);
    expect(host.list()).toEqual([]);
  });

  it('stops_aServer_andFreesItsPort', async () => {
    await host.open(path.join(ROOT, 'index.html'));

    await host.stop(ROOT);

    expect(endpoints[0].sent.at(-1)).toEqual({ op: 'stop', params: { serverId: 's1' } });
    expect(host.list()).toEqual([]);
    expect(announced.at(-1)).toEqual([]);
  });

  it('stops_theServer_whenItsWorkspaceCloses', async () => {
    await host.open(path.join(ROOT, 'index.html'));

    host.stopWithin(ROOT);
    await Promise.resolve();

    expect(host.list()).toEqual([]);
    expect(endpoints[0].sent.at(-1)?.op).toBe('stop');
  });

  it('forgets_itsServers_whenThePluginExits', async () => {
    await host.open(path.join(ROOT, 'index.html'));

    endpoints[0].exit();

    expect(host.list()).toEqual([]);
    expect(announced.at(-1)).toEqual([]);
  });

  it('restarts_thePlugin_afterAnUpdate', async () => {
    await host.open(path.join(ROOT, 'index.html'));

    host.restartPlugin('live-server');
    await host.open(path.join(ROOT, 'index.html'));

    expect(endpoints[0].disposed).toBe(true);
    expect(endpoints).toHaveLength(2);
  });

  it('says_so_whenThePluginWillNotStart', async () => {
    host = new LiveServerHost({
      descriptors: (): readonly LiveServerDescriptor[] => descriptors,
      roots: new FakeRoots([ROOT]),
      onChanged: (): void => undefined,
      realPath: (target: string): Promise<string> => Promise.resolve(target),
      isFile: (): Promise<boolean> => Promise.resolve(true),
      createClient: (
        _id: string,
        _spec: LiveServerSpec,
        onExited: () => void,
      ): LiveServerEndpoint => {
        const endpoint: FakeEndpoint = new FakeEndpoint(onExited);
        endpoint.startsOk = false;
        return endpoint;
      },
    });

    const answer: LiveServerOpenAnswer = await host.open(path.join(ROOT, 'index.html'));

    expect(answer).toEqual({ ok: false, error: 'Live Server could not be started.' });
  });
});
