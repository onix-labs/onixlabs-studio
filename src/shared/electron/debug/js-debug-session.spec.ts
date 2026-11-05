import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server, Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DapMessageDecoder, encodeMessage } from './dap-protocol';
import { JsDebugSession } from './js-debug-session';

/**
 * Waits for a condition.
 * @param condition The condition.
 * @param what What is being waited for.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline: number = Date.now() + 4_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 5));
  }
}

/**
 * Whether a process is alive.
 * @param pid The process.
 * @returns Returns true while it runs.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * One connection to the fake js-debug server, answering every request but the ones it is told to leave.
 */
class Peer {
  public readonly requests: DebugProtocol.Request[] = [];
  public readonly responses: DebugProtocol.Response[] = [];
  private readonly decoder: DapMessageDecoder = new DapMessageDecoder();
  private seq: number = 1000;

  /**
   * Gets whether the session has hung up on this connection.
   */
  public closed: boolean = false;

  public constructor(private readonly socket: Socket) {
    socket.on('error', (): void => undefined);
    socket.on('close', (): void => {
      this.closed = true;
    });
    socket.on('data', (chunk: Buffer): void => {
      for (const message of this.decoder.append(chunk)) {
        if (message.type === 'response') {
          this.responses.push(message as DebugProtocol.Response);
        } else {
          this.receive(message as DebugProtocol.Request);
        }
      }
    });
  }

  public commands(): string[] {
    return this.requests.map((request: DebugProtocol.Request): string => request.command);
  }

  public last(command: string): DebugProtocol.Request | undefined {
    return this.requests
      .filter((request: DebugProtocol.Request): boolean => request.command === command)
      .at(-1);
  }

  public send(message: Record<string, unknown>): void {
    this.socket.write(encodeMessage({ seq: this.seq++, type: 'event', ...message }));
  }

  public event(event: string, body?: unknown): void {
    this.send({ type: 'event', event, body });
  }

  public reverse(command: string, args?: unknown): number {
    const seq: number = this.seq;
    this.send({ type: 'request', command, arguments: args });
    return seq;
  }

  public close(): void {
    this.socket.destroy();
  }

  private receive(request: DebugProtocol.Request): void {
    this.requests.push(request);
    // js-debug answers a launch only once it is configured; nothing here waits on that answer.
    if (request.command !== 'launch' && request.command !== 'attach') {
      this.send({
        type: 'response',
        request_seq: request.seq,
        success: true,
        command: request.command,
        body: { from: request.command },
      });
    }
  }
}

describe.skipIf(process.platform === 'win32')('JsDebugSession', () => {
  let scratch: string = '';
  let server: Server;
  let port: number = 0;
  let peers: Peer[] = [];
  let session: JsDebugSession;
  let events: DebugProtocol.Event[] = [];
  let exits: (number | null)[] = [];

  /**
   * Starts and initializes a session, leaving the fake server connected as its parent.
   * @returns Returns the parent's connection.
   */
  async function running(): Promise<Peer> {
    await session.start();
    await session.initialize('js-debug');
    return peers[0];
  }

  /**
   * Has a connection ask for a target to be started, and waits for it to launch.
   * @param requester The connection asking.
   * @param id Identifies the target's configuration.
   * @param request The kind of target.
   * @returns Returns the target's connection.
   */
  async function target(requester: Peer, id: string, request: string = 'launch'): Promise<Peer> {
    const count: number = peers.length;
    requester.reverse('startDebugging', { request, configuration: { id } });
    await until((): boolean => peers.length > count, 'the target to connect');
    const peer: Peer = peers[count];
    await until((): boolean => peer.last(request) !== undefined, 'the target to launch');
    return peer;
  }

  /**
   * Gets the debug server's process id.
   * @returns Returns it.
   */
  function pid(): number {
    return Number(readFileSync(path.join(scratch, 'pid'), 'utf8'));
  }

  /**
   * Gets the names of the events surfaced so far.
   * @returns Returns them.
   */
  function surfaced(): string[] {
    return events.map((event: DebugProtocol.Event): string => event.event);
  }

  beforeEach(async () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-js-debug-'));
    peers = [];
    events = [];
    exits = [];
    server = createServer((socket: Socket): void => void peers.push(new Peer(socket)));
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
    const banner: string = path.join(scratch, 'banner.cjs');
    const pidFile: string = path.join(scratch, 'pid');
    writeFileSync(
      banner,
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
       console.log('Debug server listening at 127.0.0.1:${port}');
       setInterval(() => undefined, 1000);`,
    );
    session = new JsDebugSession({ command: process.execPath, args: [banner] }, scratch);
    session.onEvent((event: DebugProtocol.Event): void => void events.push(event));
    session.onExit((code: number | null): void => void exits.push(code));
  });

  afterEach(async () => {
    session.dispose();
    for (const peer of peers) {
      peer.close();
    }
    await new Promise<void>((resolve: () => void): void => void server.close(() => resolve()));
    rmSync(scratch, { recursive: true, force: true });
  });

  it('rewritesALaunchToJsDebugsOwnType_onTheParent', async () => {
    const parent: Peer = await running();

    void session
      .sendRequest('launch', { type: 'node', program: 'a.js' })
      .catch((): void => undefined);
    await until((): boolean => parent.last('launch') !== undefined, 'the launch');

    expect(parent.last('launch')?.arguments).toEqual({ type: 'pwa-node', program: 'a.js' });
  });

  it('passesOnLaunchArgumentsThatAreNotAnObject', async () => {
    const parent: Peer = await running();

    void session.sendRequest('attach', 'raw').catch((): void => undefined);
    await until((): boolean => parent.last('attach') !== undefined, 'the attach');

    expect(parent.last('attach')?.arguments).toBe('raw');
  });

  it('answersTheParentsInitialized_itself_withoutSurfacingIt', async () => {
    const parent: Peer = await running();

    parent.event('initialized');
    await until((): boolean => parent.last('configurationDone') !== undefined, 'the answer');

    expect(events).toEqual([]);
  });

  it('refusesATargetRequest_beforeThereIsATarget', async () => {
    await running();

    await expect(session.sendRequest('threads')).rejects.toThrow('No active debug target');
  });

  it('startsATarget_withWhatJsDebugAskedFor', async () => {
    const parent: Peer = await running();

    const child: Peer = await target(parent, 't1');

    expect(child.commands().slice(0, 2)).toEqual(['initialize', 'launch']);
    expect(child.last('launch')?.arguments).toEqual({ id: 't1' });
    await until((): boolean => parent.responses.length > 0, 'the reverse response');
    expect(parent.responses[0]).toMatchObject({ command: 'startDebugging', success: true });
  });

  it('startsAnAttachTarget_withAnAttach', async () => {
    const parent: Peer = await running();

    const child: Peer = await target(parent, 't1', 'attach');

    expect(child.last('attach')?.arguments).toEqual({ id: 't1' });
  });

  it('surfacesTheFirstTargetsInitialized_andRoutesRequestsThere', async () => {
    const parent: Peer = await running();
    const child: Peer = await target(parent, 't1');

    child.event('initialized');
    await until((): boolean => surfaced().includes('initialized'), 'the event');

    expect(await session.sendRequest('threads')).toEqual({ from: 'threads' });
    expect(child.commands()).toContain('threads');
    expect(parent.commands()).not.toContain('threads');
  });

  it('sendsDisconnectToTheParent_notTheTarget', async () => {
    const parent: Peer = await running();
    const child: Peer = await target(parent, 't1');
    child.event('initialized');
    await until((): boolean => surfaced().includes('initialized'), 'the event');

    await session.sendRequest('disconnect', { terminateDebuggee: true });

    expect(parent.commands()).toContain('disconnect');
    expect(child.commands()).not.toContain('disconnect');
  });

  it('configuresALaterTarget_itself_withTheBreakpointsTheRendererSet', async () => {
    const parent: Peer = await running();
    const first: Peer = await target(parent, 't1');
    first.event('initialized');
    await until((): boolean => surfaced().includes('initialized'), 'the first target');
    const kept: unknown = { source: { path: '/a.js' }, breakpoints: [{ line: 3 }] };
    await session.sendRequest('setBreakpoints', {
      source: { path: '/a.js' },
      breakpoints: [{ line: 1 }],
    });
    await session.sendRequest('setBreakpoints', kept);
    await session.sendRequest('setBreakpoints', {
      source: { path: '/cleared.js' },
      breakpoints: [{ line: 1 }],
    });
    await session.sendRequest('setBreakpoints', { source: { path: '/cleared.js' } });
    await session.sendRequest('setBreakpoints', { source: {}, breakpoints: [{ line: 9 }] });

    const second: Peer = await target(parent, 't2');
    second.event('initialized');
    await until((): boolean => second.last('configurationDone') !== undefined, 'the set-up');

    expect(surfaced().filter((name: string): boolean => name === 'initialized')).toHaveLength(1);
    expect(
      second.requests
        .filter((request: DebugProtocol.Request): boolean => request.command === 'setBreakpoints')
        .map((request: DebugProtocol.Request): unknown => request.arguments),
    ).toEqual([kept]);
  });

  it('routesRequestsToWhicheverTargetStoppedLast', async () => {
    const parent: Peer = await running();
    const first: Peer = await target(parent, 't1');
    first.event('initialized');
    await until((): boolean => surfaced().includes('initialized'), 'the first target');
    const second: Peer = await target(parent, 't2');

    second.event('stopped', { reason: 'breakpoint' });
    await until((): boolean => surfaced().includes('stopped'), 'the stop');
    await session.sendRequest('stackTrace');

    expect(second.commands()).toContain('stackTrace');
    expect(first.commands()).not.toContain('stackTrace');
  });

  it('surfacesOnlyWhatTheRendererDrives', async () => {
    const parent: Peer = await running();
    const child: Peer = await target(parent, 't1');

    for (const name of ['loadedSource', 'output', 'module', 'continued', 'exited']) {
      child.event(name);
    }
    await until((): boolean => surfaced().includes('exited'), 'the events');

    expect(surfaced()).toEqual(['output', 'continued', 'exited']);
  });

  it('endsOnce_andOnlyWhenTheLastTargetHasGone', async () => {
    const parent: Peer = await running();
    const first: Peer = await target(parent, 't1');
    first.event('initialized');
    await until((): boolean => surfaced().includes('initialized'), 'the first target');
    const second: Peer = await target(parent, 't2');

    first.event('terminated');
    await until((): boolean => first.closed, 'the first target to go');
    await session.sendRequest('threads');
    expect(second.commands()).toContain('threads');
    expect(surfaced()).not.toContain('terminated');

    second.event('terminated');
    await until((): boolean => surfaced().includes('terminated'), 'the end');
    second.close();
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 30));

    expect(surfaced().filter((name: string): boolean => name === 'terminated')).toHaveLength(1);
  });

  it('takesATargetsSocketClosing_asItsEnd', async () => {
    const parent: Peer = await running();
    const child: Peer = await target(parent, 't1');

    child.close();

    await until((): boolean => surfaced().includes('terminated'), 'the end');
  });

  it('startsNoTarget_onceTheSessionHasEnded', async () => {
    const parent: Peer = await running();
    const child: Peer = await target(parent, 't1');
    child.event('terminated');
    await until((): boolean => surfaced().includes('terminated'), 'the end');
    const count: number = peers.length;

    parent.reverse('startDebugging', { configuration: {} });
    await until((): boolean => parent.responses.length > 1, 'the reverse response');
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 30));

    expect(peers).toHaveLength(count);
  });

  it('aTargetThatCannotConnect_endsTheSession_ratherThanLeavingItHanging', async () => {
    const parent: Peer = await running();
    server.close();

    parent.reverse('startDebugging', { configuration: {} });

    await until((): boolean => surfaced().includes('terminated'), 'the end');
  });

  it('reportsTheServerExiting_andEndsTheSession', async () => {
    await running();

    // The fake server takes a kill for a crash: nothing in the session asked for it.
    process.kill(pid(), 'SIGKILL');
    await until((): boolean => exits.length > 0, 'the exit');

    expect(exits).toEqual([null]);
    expect(surfaced()).toEqual(['terminated']);
  });

  it('refusesARunInTerminal_whenNothingIsListening', async () => {
    const parent: Peer = await running();

    parent.reverse('runInTerminal', { args: ['node'] });
    await until((): boolean => parent.responses.length > 0, 'the reverse response');

    expect(parent.responses[0]).toMatchObject({ command: 'runInTerminal', success: false });
  });

  it('answersARunInTerminal_onTheConnectionThatAsked', async () => {
    const parent: Peer = await running();
    const child: Peer = await target(parent, 't1');
    await until((): boolean => parent.responses.length > 0, 'the start answer');
    session.onRunInTerminal(
      (_request: DebugProtocol.Request, respond: (body?: unknown) => void): void =>
        respond({ processId: 77 }),
    );

    child.reverse('runInTerminal', { args: ['node'] });
    await until((): boolean => child.responses.length > 0, 'the reverse response');

    expect(child.responses[0]).toMatchObject({ success: true, body: { processId: 77 } });
    expect(parent.responses).toHaveLength(1);
  });

  it('disposeEndsEveryConnection_andIsSafeToRepeat', async () => {
    const parent: Peer = await running();
    await target(parent, 't1');

    session.dispose();

    expect((): void => session.dispose()).not.toThrow();
    await expect(session.sendRequest('threads')).rejects.toThrow('No active debug target');
  });

  it('saysNothingMoreOnceDisposed_soALateExitCannotLandOnTheSessionsSuccessor', async () => {
    await running();
    const serverPid: number = pid();

    session.dispose();
    await until((): boolean => !alive(serverPid), 'the server to end');
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 30));

    expect(exits).toEqual([]);
    expect(events).toEqual([]);
  });
});
