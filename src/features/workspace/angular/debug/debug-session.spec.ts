import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { DebugChannel, DebugEventMessage, DebugStartResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { ProjectCapabilities } from '@shared/api/project-system';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Output } from '@shared/angular/services/output/output';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { Breakpoints } from '@shared/angular/services/debug/breakpoints';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { SolutionModel } from '@features/workspace/angular/project/solution-model';
import { DebugSession } from './debug-session';

/**
 * A recorded request/notification made through the fake transport.
 */
interface RecordedInvoke {
  readonly channel: string;
  readonly args: readonly unknown[];
}

/**
 * A fake transport that records invocations, lets the test drive main→renderer events, and returns a
 * controllable start result. Routes the debug channels; other channels resolve to null.
 */
class FakeBridge implements Bridge {
  public startResult: DebugStartResult = { success: true, capabilities: {} };
  public setBreakpointsBody: unknown = { breakpoints: [] };
  public readonly invokes: RecordedInvoke[] = [];
  private readonly listeners: Map<string, (...args: unknown[]) => void> = new Map<
    string,
    (...args: unknown[]) => void
  >();

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    this.invokes.push({ channel, args });
    if (channel === (DebugChannel.Start as string)) {
      return Promise.resolve(this.startResult as T);
    }
    if (channel === (DebugChannel.Request as string) && args[1] === 'setBreakpoints') {
      return Promise.resolve(this.setBreakpointsBody as T);
    }
    return Promise.resolve(undefined as T);
  }

  public send(): void {
    return undefined;
  }

  public on(channel: string, listener: (...args: unknown[]) => void): () => void {
    this.listeners.set(channel, listener);
    return (): void => {
      this.listeners.delete(channel);
    };
  }

  public emit(channel: string, payload: unknown): void {
    this.listeners.get(channel)?.(payload);
  }

  public invokesOn(channel: string): RecordedInvoke[] {
    return this.invokes.filter((invoke: RecordedInvoke): boolean => invoke.channel === channel);
  }

  public requests(): { command: string; args: unknown }[] {
    return this.invokesOn(DebugChannel.Request).map((invoke: RecordedInvoke) => ({
      command: invoke.args[1] as string,
      args: invoke.args[2],
    }));
  }
}

/**
 * A fake Output channel recording what was written.
 */
class FakeOutput {
  public readonly appended: string[] = [];
  public readonly lines: string[] = [];

  public append(text: string): void {
    this.appended.push(text);
  }

  public appendLine(text: string): void {
    this.lines.push(text);
  }
}

/**
 * Builds a run configuration.
 * @param overrides Fields to override on the base configuration.
 * @returns Returns the configuration.
 */
function config(overrides: Partial<RunConfiguration> = {}): RunConfiguration {
  return { id: 'c', name: 'App', providerKind: 'dotnet', mode: 'debug', ...overrides };
}

/**
 * Builds capabilities declaring a debug adapter.
 * @param adapter The adapter id, or null for no debug capability.
 * @returns Returns the capabilities.
 */
function capabilities(adapter: string | null): ProjectCapabilities {
  return {
    actions: [],
    buildConfigurations: [],
    target: null,
    debug: adapter === null ? null : { adapter },
  };
}

/**
 * Resolves pending microtasks so the session's async launch settles.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('DebugSession', () => {
  let bridge: FakeBridge;
  let output: FakeOutput;
  let root: WritableSignal<DirectoryListing | null>;
  let caps: WritableSignal<ProjectCapabilities | null>;

  /**
   * Builds the service under test with the fakes wired in.
   * @returns Returns the service.
   */
  function build(): DebugSession {
    TestBed.configureTestingModule({
      providers: [
        DebugSession,
        Breakpoints,
        { provide: SettingsStore, useValue: { get: <T>(_k: string, f: T): T => f, set: (): void => undefined } },
        { provide: Workspace, useValue: { root } },
        { provide: Output, useValue: output },
        { provide: SolutionModel, useValue: { capabilities: caps } },
      ],
    });
    return TestBed.inject(DebugSession);
  }

  beforeEach(() => {
    bridge = new FakeBridge();
    output = new FakeOutput();
    root = signal<DirectoryListing | null>({ path: '/ws', name: 'ws', entries: [] });
    caps = signal<ProjectCapabilities | null>(capabilities('netcoredbg'));
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    // Remove the fake bridge so a later spec asserting its absence is not polluted by this one.
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('launch_withNoAdapter_reportsAndStaysIdle', async () => {
    caps.set(capabilities(null));
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    expect(session.state()).toBe('idle');
    expect(output.lines.some((l) => l.includes('No debug adapter'))).toBe(true);
    expect(bridge.invokesOn(DebugChannel.Start)).toHaveLength(0);
  });

  it('launch_startsTheAdapterAndSendsLaunch', async () => {
    const session: DebugSession = build();
    session.launch(config({ name: 'App', args: ['--flag'] }));
    await flush();

    const start: RecordedInvoke = bridge.invokesOn(DebugChannel.Start)[0];
    expect(start.args[0]).toMatchObject({ adapterId: 'netcoredbg', rootPath: '/ws' });
    expect(session.state()).toBe('running');

    const launch: { command: string; args: unknown } | undefined = bridge
      .requests()
      .find((r) => r.command === 'launch');
    expect(launch).toBeDefined();
    expect(launch?.args).toMatchObject({ name: 'App', cwd: '/ws', args: ['--flag'] });
  });

  it('launch_failure_reportsAndResetsToIdle', async () => {
    bridge.startResult = { success: false, error: 'adapter missing' };
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    expect(session.state()).toBe('idle');
    expect(output.lines.some((l) => l.includes('adapter missing'))).toBe(true);
    expect(bridge.requests().some((r) => r.command === 'launch')).toBe(false);
  });

  it('onInitialized_sendsConfigurationDoneWhenSupported', async () => {
    bridge.startResult = { success: true, capabilities: { supportsConfigurationDoneRequest: true } };
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'initialized'));
    await flush();

    expect(bridge.requests().some((r) => r.command === 'configurationDone')).toBe(true);
  });

  it('onInitialized_skipsConfigurationDoneWhenUnsupported', async () => {
    bridge.startResult = { success: true, capabilities: {} };
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'initialized'));

    expect(bridge.requests().some((r) => r.command === 'configurationDone')).toBe(false);
  });

  it('routesOutputEventsIntoTheOutputChannel', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'output',
      body: { category: 'stdout', output: 'hello\n' },
    } satisfies DebugEventMessage);

    expect(output.appended).toContain('hello\n');
  });

  it('ignoresEventsForAnotherSession', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    bridge.emit(DebugChannel.Event, {
      sessionId: 'other#1',
      event: 'output',
      body: { output: 'nope' },
    } satisfies DebugEventMessage);

    expect(output.appended).not.toContain('nope');
  });

  it('stopped_thenContinue_resumesTheReportedThread', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 7 },
    } satisfies DebugEventMessage);
    expect(session.state()).toBe('stopped');

    session.continue();
    expect(session.state()).toBe('running');
    const cont: { command: string; args: unknown } | undefined = bridge
      .requests()
      .find((r) => r.command === 'continue');
    expect(cont?.args).toEqual({ threadId: 7 });
  });

  it('stepCommandsOnlyActWhenStopped', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    // Running (not stopped): a step is ignored.
    session.stepOver();
    expect(bridge.requests().some((r) => r.command === 'next')).toBe(false);

    const sessionId: string = currentSessionId(bridge);
    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'step', threadId: 1 },
    } satisfies DebugEventMessage);
    session.stepIn();
    expect(bridge.requests().some((r) => r.command === 'stepIn')).toBe(true);
  });

  it('terminated_stopsTheSessionAndResetsToIdle', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'terminated'));

    expect(session.state()).toBe('idle');
    expect(bridge.invokesOn(DebugChannel.Stop)).toHaveLength(1);
  });

  it('adapterExit_resetsToIdle', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.AdapterExit, { sessionId, code: 0, signal: null });

    expect(session.state()).toBe('idle');
  });

  it('stop_terminatesAndResets', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    session.stop();

    expect(session.state()).toBe('idle');
    expect(bridge.invokesOn(DebugChannel.Stop)).toHaveLength(1);
  });

  it('onInitialized_sendsSetBreakpointsBeforeConfigurationDone', async () => {
    bridge.startResult = { success: true, capabilities: { supportsConfigurationDoneRequest: true } };
    const session: DebugSession = build();
    const breakpoints: Breakpoints = TestBed.inject(Breakpoints);
    breakpoints.add('/ws/main.ts', 12, { condition: 'x > 1' });
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'initialized'));
    await flush();

    const commands: string[] = bridge.requests().map((r) => r.command);
    expect(commands.indexOf('setBreakpoints')).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('setBreakpoints')).toBeLessThan(commands.indexOf('configurationDone'));
    const set: { command: string; args: unknown } | undefined = bridge
      .requests()
      .find((r) => r.command === 'setBreakpoints');
    expect(set?.args).toMatchObject({
      source: { path: '/ws/main.ts' },
      breakpoints: [{ line: 12, condition: 'x > 1' }],
    });
  });

  it('appliesVerificationFromSetBreakpointsResponse', async () => {
    bridge.setBreakpointsBody = { breakpoints: [{ line: 12, verified: true }] };
    const session: DebugSession = build();
    const breakpoints: Breakpoints = TestBed.inject(Breakpoints);
    breakpoints.add('/ws/main.ts', 12);
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'initialized'));
    await flush();

    expect(breakpoints.forPath('/ws/main.ts')[0].verified).toBe(true);
  });

  it('terminated_clearsBreakpointVerification', async () => {
    bridge.setBreakpointsBody = { breakpoints: [{ line: 12, verified: true }] };
    const session: DebugSession = build();
    const breakpoints: Breakpoints = TestBed.inject(Breakpoints);
    breakpoints.add('/ws/main.ts', 12);
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);
    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'initialized'));
    await flush();
    expect(breakpoints.forPath('/ws/main.ts')[0].verified).toBe(true);

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'terminated'));

    expect(breakpoints.forPath('/ws/main.ts')[0].verified).toBe(false);
  });

  it('doesNotStartASecondSessionWhileOneIsRunning', async () => {
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    session.launch(config());
    await flush();

    expect(bridge.invokesOn(DebugChannel.Start)).toHaveLength(1);
  });
});

/**
 * Builds an event message with no body.
 * @param sessionId The session the event belongs to.
 * @param event The event name.
 * @returns Returns the message.
 */
function sessionIdEvent(sessionId: string, event: string): DebugEventMessage {
  return { sessionId, event };
}

/**
 * Reads the session id the session started with from the recorded Start invocation.
 * @param bridge The fake bridge.
 * @returns Returns the session id.
 */
function currentSessionId(bridge: FakeBridge): string {
  const start: RecordedInvoke = bridge.invokesOn(DebugChannel.Start)[0];
  return (start.args[0] as { sessionId: string }).sessionId;
}
