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
  /**
   * The result the resolve channel returns; defaults to a successful target so launch reaches the
   * adapter.
   */
  public resolveResult: unknown = { target: { program: '/ws/App.dll', cwd: '/ws' }, error: null };
  /**
   * Canned response bodies keyed by DAP command, for requests the test drives (stackTrace, scopes,
   * variables, evaluate). A command absent from the map resolves undefined.
   */
  public readonly responses: Map<string, unknown> = new Map<string, unknown>();
  /**
   * Commands the fake should reject, to exercise failure paths.
   */
  public readonly rejects: Set<string> = new Set<string>();
  public readonly invokes: RecordedInvoke[] = [];
  private readonly listeners: Map<string, (...args: unknown[]) => void> = new Map<
    string,
    (...args: unknown[]) => void
  >();

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    this.invokes.push({ channel, args });
    if (channel === (DebugChannel.Resolve as string)) {
      return Promise.resolve(this.resolveResult as T);
    }
    if (channel === (DebugChannel.Start as string)) {
      return Promise.resolve(this.startResult as T);
    }
    if (channel === (DebugChannel.Request as string)) {
      const command: string = args[1] as string;
      if (this.rejects.has(command)) {
        return Promise.reject(new Error(`${command} failed`));
      }
      if (command === 'setBreakpoints') {
        return Promise.resolve(this.setBreakpointsBody as T);
      }
      if (this.responses.has(command)) {
        return Promise.resolve(this.responses.get(command) as T);
      }
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

  it('resolveFailure_reportsAndStaysIdleWithoutStartingTheAdapter', async () => {
    bridge.resolveResult = { target: null, error: 'Build failed.\nProgram.cs(3): error CS1002' };
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    expect(session.state()).toBe('idle');
    expect(output.lines.some((l) => l.includes('Build failed'))).toBe(true);
    expect(bridge.invokesOn(DebugChannel.Start)).toHaveLength(0);
  });

  it('launch_sendsTheResolvedProgramAndWorkingDirectory', async () => {
    bridge.resolveResult = {
      target: { program: '/ws/bin/Debug/net10.0/App.dll', cwd: '/ws/proj' },
      error: null,
    };
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    const launch: { command: string; args: unknown } | undefined = bridge
      .requests()
      .find((r) => r.command === 'launch');
    expect(launch?.args).toMatchObject({
      program: '/ws/bin/Debug/net10.0/App.dll',
      cwd: '/ws/proj',
    });
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

  it('stopped_fetchesCallStackScopesAndLocation', async () => {
    bridge.responses.set('stackTrace', {
      stackFrames: [
        { id: 1000, name: 'Main', source: { path: '/ws/Program.cs' }, line: 13, column: 5 },
        { id: 1001, name: 'outer', line: 1, column: 1 },
      ],
    });
    bridge.responses.set('scopes', {
      scopes: [{ name: 'Locals', variablesReference: 2000, expensive: false }],
    });
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);

    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    } satisfies DebugEventMessage);
    await flush();

    expect(session.callStack().map((f) => f.name)).toEqual(['Main', 'outer']);
    expect(session.currentFrame()).toBe(1000);
    expect(session.scopes()).toEqual([
      { name: 'Locals', variablesReference: 2000, expensive: false },
    ]);
    expect(session.location()).toEqual({ path: '/ws/Program.cs', line: 13, column: 5 });
    const stack: { command: string; args: unknown } | undefined = bridge
      .requests()
      .find((r) => r.command === 'stackTrace');
    expect(stack?.args).toMatchObject({ threadId: 1 });
  });

  it('selectFrame_loadsScopesForThatFrameAndMovesLocation', async () => {
    bridge.responses.set('stackTrace', {
      stackFrames: [
        { id: 1000, name: 'Main', source: { path: '/ws/Program.cs' }, line: 13, column: 5 },
        { id: 1001, name: 'Outer', source: { path: '/ws/Outer.cs' }, line: 4, column: 2 },
      ],
    });
    bridge.responses.set('scopes', { scopes: [] });
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);
    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    } satisfies DebugEventMessage);
    await flush();

    await session.selectFrame(1001);

    expect(session.currentFrame()).toBe(1001);
    expect(session.location()).toEqual({ path: '/ws/Outer.cs', line: 4, column: 2 });
    const scopeRequests: { command: string; args: unknown }[] = bridge
      .requests()
      .filter((r) => r.command === 'scopes');
    expect(scopeRequests.some((r) => (r.args as { frameId: number }).frameId === 1001)).toBe(true);
  });

  it('variables_fetchesChildrenAndSkipsLeafReferences', async () => {
    bridge.responses.set('variables', {
      variables: [{ name: 'x', value: '1', type: 'int', variablesReference: 0 }],
    });
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    const children: readonly { name: string }[] = await session.variables(2000);
    expect(children).toEqual([{ name: 'x', value: '1', type: 'int', variablesReference: 0 }]);

    // A leaf reference (0) does not hit the adapter.
    const none: readonly unknown[] = await session.variables(0);
    expect(none).toEqual([]);
    expect(bridge.requests().filter((r) => r.command === 'variables')).toHaveLength(1);
  });

  it('evaluate_returnsResultAgainstTheSelectedFrame', async () => {
    bridge.responses.set('stackTrace', {
      stackFrames: [{ id: 1000, name: 'Main', source: { path: '/ws/Program.cs' }, line: 1, column: 1 }],
    });
    bridge.responses.set('scopes', { scopes: [] });
    bridge.responses.set('evaluate', { result: '42', variablesReference: 0 });
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);
    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    } satisfies DebugEventMessage);
    await flush();

    const result: { result: string; failed: boolean } = await session.evaluate('x + 1');
    expect(result).toEqual({ result: '42', variablesReference: 0, failed: false });
    const evaluate: { command: string; args: unknown } | undefined = bridge
      .requests()
      .find((r) => r.command === 'evaluate');
    expect(evaluate?.args).toMatchObject({ expression: 'x + 1', frameId: 1000, context: 'watch' });
  });

  it('evaluate_failureReturnsFailedWithMessage', async () => {
    bridge.rejects.add('evaluate');
    const session: DebugSession = build();
    session.launch(config());
    await flush();

    const result: { failed: boolean } = await session.evaluate('bad');
    expect(result.failed).toBe(true);
  });

  it('continued_clearsInspection', async () => {
    bridge.responses.set('stackTrace', {
      stackFrames: [{ id: 1000, name: 'Main', source: { path: '/ws/Program.cs' }, line: 1, column: 1 }],
    });
    bridge.responses.set('scopes', { scopes: [{ name: 'Locals', variablesReference: 2, expensive: false }] });
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);
    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    } satisfies DebugEventMessage);
    await flush();
    expect(session.callStack()).toHaveLength(1);

    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'continued',
      body: { threadId: 1 },
    } satisfies DebugEventMessage);

    expect(session.state()).toBe('running');
    expect(session.callStack()).toHaveLength(0);
    expect(session.scopes()).toHaveLength(0);
    expect(session.currentFrame()).toBeNull();
    expect(session.location()).toBeNull();
  });

  it('terminated_clearsInspection', async () => {
    bridge.responses.set('stackTrace', {
      stackFrames: [{ id: 1000, name: 'Main', source: { path: '/ws/Program.cs' }, line: 1, column: 1 }],
    });
    bridge.responses.set('scopes', { scopes: [] });
    const session: DebugSession = build();
    session.launch(config());
    await flush();
    const sessionId: string = currentSessionId(bridge);
    bridge.emit(DebugChannel.Event, {
      sessionId,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    } satisfies DebugEventMessage);
    await flush();
    expect(session.location()).not.toBeNull();

    bridge.emit(DebugChannel.Event, sessionIdEvent(sessionId, 'terminated'));

    expect(session.callStack()).toHaveLength(0);
    expect(session.location()).toBeNull();
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
