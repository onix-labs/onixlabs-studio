import { effect, inject, OnDestroy, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { Bridge } from '@shared/api/bridge';
import {
  DebugAdapterExit,
  DebugChannel,
  DebugEventMessage,
  DebugLaunchTarget,
  DebugResolveResult,
  DebugRunInTerminalRequest,
  DebugRunInTerminalResponse,
  DebugStartResult,
} from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { Output, OutputChannel } from '@shared/angular/services/output/output';
import {
  TerminalLaunch,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { DebugHandler, DebugLocation, DebugState } from '@shared/angular/services/debug/debugger';
import { Breakpoint, Breakpoints } from '@shared/angular/services/debug/breakpoints';
import { SolutionModel } from '@features/workspace/angular/project/solution-model';

/**
 * The thread id execution-control requests fall back to before the adapter has reported a stopped
 * thread. Adapters that model a single thread (netcoredbg, node) use thread id 1.
 */
const DEFAULT_THREAD_ID: number = 1;

/**
 * The adapters that honour `runInTerminal`: launched with an integrated console, they ask the client
 * to host the debuggee in a run terminal, so stdin-reading programs are debuggable. netcoredbg stays
 * on internalConsole until a real .NET run confirms its support (see #343).
 */
const RUN_IN_TERMINAL_ADAPTERS: ReadonlySet<string> = new Set<string>(['js-debug']);

/**
 * The maximum number of stack frames requested for the call stack, a bound so a runaway recursion does
 * not fetch an unbounded stack.
 */
const MAX_STACK_FRAMES: number = 50;

/**
 * A call-stack frame the debug UI renders, mapped from the adapter's richer frame.
 */
export interface DebugFrame {
  /**
   * Gets the adapter's frame id, used to request the frame's scopes.
   */
  readonly id: number;

  /**
   * Gets the frame's display name (usually the function or method).
   */
  readonly name: string;

  /**
   * Gets the absolute path of the frame's source file, or null when the frame has no source (a runtime
   * or library frame).
   */
  readonly path: string | null;

  /**
   * Gets the 1-based line the frame is at.
   */
  readonly line: number;

  /**
   * Gets the 1-based column the frame is at.
   */
  readonly column: number;
}

/**
 * A variable scope (locals, arguments, globals) for a stack frame.
 */
export interface DebugScope {
  /**
   * Gets the scope's display name.
   */
  readonly name: string;

  /**
   * Gets the reference the scope's variables are fetched by.
   */
  readonly variablesReference: number;

  /**
   * Gets whether the scope is expensive to fetch, so the UI can collapse it by default.
   */
  readonly expensive: boolean;
}

/**
 * A variable the debug UI renders, mapped from the adapter's richer variable.
 */
export interface DebugVariable {
  /**
   * Gets the variable's name.
   */
  readonly name: string;

  /**
   * Gets the variable's rendered value.
   */
  readonly value: string;

  /**
   * Gets the variable's type, or null when the adapter does not report one.
   */
  readonly type: string | null;

  /**
   * Gets the reference the variable's children are fetched by, or 0 when it is a leaf.
   */
  readonly variablesReference: number;
}

/**
 * The result of evaluating a watch expression.
 */
export interface DebugEvaluation {
  /**
   * Gets the rendered result, or an error message when the expression could not be evaluated.
   */
  readonly result: string;

  /**
   * Gets the reference the result's children are fetched by, or 0 when it is a leaf or an error.
   */
  readonly variablesReference: number;

  /**
   * Gets whether the evaluation failed.
   */
  readonly failed: boolean;
}

/**
 * Drives a single workspace's debug session over the main-process {@link
 * import('@shared/electron/debug/debug-manager').DebugManager}, and is the renderer-side orchestrator of
 * the DAP launch sequence. Provided per workspace (in the directory view) and registered with the
 * app-level {@link import('./debugger').Debugger} seam while its tab is active, mirroring how {@link
 * import('../tasks/build-runner').BuildRunner} registers with {@link import('../tasks/builds').Builds}.
 *
 * It launches a `.studio` run configuration under the adapter the workspace's project declares, sends
 * the DAP `launch` request, completes configuration when the adapter reports `initialized`, routes the
 * debuggee's `output` events into the workspace {@link Output} channel, tracks the session's lifecycle
 * as a state signal, and forwards execution-control commands. Provider-specific launch resolution
 * (building first, then pointing the adapter at the produced artifact) is layered on in a later phase.
 */
@Service()
export class DebugSession implements DebugHandler, OnDestroy {
  /**
   * Holds this workspace's open-folder state, read for the session root.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds this workspace's Output surface, whose Debug channel the debuggee's output is streamed into.
   */
  private readonly output: Output = inject(Output);

  /**
   * Holds the Debug output channel, kept distinct from the Build and Run channels.
   */
  private readonly debugChannel: OutputChannel = this.output.channel('debug', 'Debug');

  /**
   * Holds this workspace's project model, read for the declared debug adapter.
   */
  private readonly solutionModel: SolutionModel = inject(SolutionModel);

  /**
   * Holds the workspace's breakpoints, synchronised to the adapter and updated with its verification.
   */
  private readonly breakpoints: Breakpoints = inject(Breakpoints);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds this workspace's terminal sessions, hosting the debuggee when the adapter asks the client
   * to run it in a terminal.
   */
  private readonly terminals: TerminalSessions = inject(TerminalSessions);

  /**
   * Holds the disposer for the relayed `runInTerminal` subscription, or null when not subscribed.
   */
  private runInTerminalDisposer: (() => void) | null = null;

  /**
   * Holds the reused identifier of this workspace's debug run terminal, minted on first use so
   * successive debug sessions relaunch the same tab.
   */
  private debugTerminalId: string | null = null;

  /**
   * Holds whether the debug terminal's process is still running, so ending the session can stop a
   * debuggee the adapter did not tear down (no orphans).
   */
  private debugTerminalLive: boolean = false;

  /**
   * Holds the launched configuration's name while a session runs, naming the debug terminal.
   */
  private activeConfigurationName: string = '';

  /**
   * Holds the launched session's adapter id, deciding whether the launch may ask for an integrated
   * terminal.
   */
  private activeAdapterId: string = '';

  /**
   * Holds the session's lifecycle state.
   */
  private readonly stateSignal: WritableSignal<DebugState> = signal<DebugState>('idle');

  /**
   * Gets the session's lifecycle state.
   */
  public readonly state: Signal<DebugState> = this.stateSignal.asReadonly();

  /**
   * Holds the call stack of the stopped thread, or an empty list when running or idle.
   */
  private readonly callStackSignal: WritableSignal<readonly DebugFrame[]> = signal<
    readonly DebugFrame[]
  >([]);

  /**
   * Gets the call stack of the stopped thread, top frame first.
   */
  public readonly callStack: Signal<readonly DebugFrame[]> = this.callStackSignal.asReadonly();

  /**
   * Holds the id of the selected stack frame (whose scopes are shown), or null when none is stopped.
   */
  private readonly currentFrameSignal: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets the id of the selected stack frame, or null when none is stopped.
   */
  public readonly currentFrame: Signal<number | null> = this.currentFrameSignal.asReadonly();

  /**
   * Holds the selected frame's variable scopes, or an empty list when none is stopped.
   */
  private readonly scopesSignal: WritableSignal<readonly DebugScope[]> = signal<
    readonly DebugScope[]
  >([]);

  /**
   * Gets the selected frame's variable scopes.
   */
  public readonly scopes: Signal<readonly DebugScope[]> = this.scopesSignal.asReadonly();

  /**
   * Holds the source location the debuggee is paused at (the selected frame's), or null when running.
   */
  private readonly locationSignal: WritableSignal<DebugLocation | null> =
    signal<DebugLocation | null>(null);

  /**
   * Gets the source location the debuggee is paused at, or null when it is not paused. Read app-level
   * through the {@link import('@shared/angular/services/debug/debugger').Debugger} seam for the
   * current-execution-line marker.
   */
  public readonly location: Signal<DebugLocation | null> = this.locationSignal.asReadonly();

  /**
   * Holds the id of the running session, or null when none is running.
   */
  private currentSession: string | null = null;

  /**
   * Counts launched sessions, so each gets a distinct id even within one workspace root.
   */
  private counter: number = 0;

  /**
   * Holds the running adapter's advertised capabilities, deciding whether `configurationDone` is sent.
   */
  private capabilities: DebugProtocol.Capabilities = {};

  /**
   * Holds the last thread the adapter reported stopped, used to target execution-control requests.
   */
  private threadId: number | undefined;

  /**
   * Removes the adapter-event subscription.
   */
  private readonly eventDisposer: (() => void) | null;

  /**
   * Removes the adapter-exit subscription.
   */
  private readonly exitDisposer: (() => void) | null;

  /**
   * Holds the signature of the breakpoint definitions last sent to the adapter, so a re-sync is skipped
   * when only the transient verification changed (which would otherwise loop, as applying the adapter's
   * verification mutates the store the sync effect watches).
   */
  private lastSyncSignature: string = '';

  /**
   * Holds the set of file paths whose breakpoints have been sent to the adapter, so a file that loses
   * all its breakpoints mid-session is cleared on the adapter rather than left set.
   */
  private readonly syncedPaths: Set<string> = new Set<string>();

  /**
   * Subscribes to the main process's adapter events and exits, and re-synchronises breakpoints to a
   * running session whenever their definitions change.
   */
  public constructor() {
    this.eventDisposer =
      this.bridge?.on(DebugChannel.Event, (...args: unknown[]): void =>
        this.onEvent(args[0] as DebugEventMessage),
      ) ?? null;
    this.exitDisposer =
      this.bridge?.on(DebugChannel.AdapterExit, (...args: unknown[]): void =>
        this.onAdapterExit(args[0] as DebugAdapterExit),
      ) ?? null;
    this.runInTerminalDisposer =
      this.bridge?.on(DebugChannel.RunInTerminal, (...args: unknown[]): void =>
        void this.onRunInTerminal(args[0] as DebugRunInTerminalRequest),
      ) ?? null;

    // Re-send breakpoints when their definitions change during a running session. The signature guard
    // ignores verification-only changes (the adapter's response feeds back into the store), which would
    // otherwise re-trigger this effect endlessly.
    effect((): void => {
      const signature: string = definitionSignature(this.breakpoints.all());
      if (this.currentSession === null || signature === this.lastSyncSignature) {
        return;
      }
      this.lastSyncSignature = signature;
      void this.syncBreakpoints();
    });
  }

  /**
   * Stops the session and unsubscribes when the workspace tab is destroyed.
   */
  public ngOnDestroy(): void {
    this.stop();
    this.eventDisposer?.();
    this.exitDisposer?.();
    this.runInTerminalDisposer?.();
  }

  /**
   * Launches a run configuration under the debugger, when the workspace declares a debug adapter and no
   * session is already running.
   * @param configuration The run configuration to debug.
   */
  public launch(configuration: RunConfiguration): void {
    void this.launchSession(configuration);
  }

  /**
   * Resumes the paused debuggee.
   */
  public continue(): void {
    if (this.stateSignal() !== 'stopped') {
      return;
    }
    this.stateSignal.set('running');
    void this.request('continue', { threadId: this.threadId ?? DEFAULT_THREAD_ID });
  }

  /**
   * Pauses the running debuggee.
   */
  public pause(): void {
    if (this.stateSignal() !== 'running') {
      return;
    }
    void this.request('pause', { threadId: this.threadId ?? DEFAULT_THREAD_ID });
  }

  /**
   * Steps over the current line.
   */
  public stepOver(): void {
    this.step('next');
  }

  /**
   * Steps into the call at the current line.
   */
  public stepIn(): void {
    this.step('stepIn');
  }

  /**
   * Steps out of the current function.
   */
  public stepOut(): void {
    this.step('stepOut');
  }

  /**
   * Stops the session, terminating the debuggee, and resets to idle.
   */
  public stop(): void {
    const id: string | null = this.currentSession;
    if (id === null) {
      return;
    }
    void this.bridge?.invoke(DebugChannel.Stop, id);
    this.reset();
  }

  /**
   * Runs the launch sequence: starts the adapter, then sends the `launch` request; the adapter's
   * `initialized` event completes configuration.
   * @param configuration The run configuration to debug.
   */
  private async launchSession(configuration: RunConfiguration): Promise<void> {
    this.activeConfigurationName = configuration.name;
    this.activeAdapterId = this.solutionModel.capabilities()?.debug?.adapter ?? '';
    if (this.bridge === undefined || this.stateSignal() !== 'idle') {
      return;
    }
    const adapter: string | undefined = this.solutionModel.capabilities()?.debug?.adapter;
    const root: string | undefined = this.workspace.root()?.path;
    if (adapter === undefined) {
      this.debugChannel.appendLine('No debug adapter is available for this workspace.');
      return;
    }
    if (root === undefined) {
      return;
    }
    const sessionId: string = `${root}#${++this.counter}`;
    this.currentSession = sessionId;
    this.threadId = undefined;
    this.capabilities = {};
    this.stateSignal.set('running');
    this.debugChannel.reveal();
    this.debugChannel.appendLine(`> Debug ${configuration.name}`);

    // Resolve the launch target first — for compiled ecosystems this builds the project and locates the
    // produced artifact, so the build happens before the adapter is even spawned.
    const resolution: DebugResolveResult = await this.bridge.invoke<DebugResolveResult>(
      DebugChannel.Resolve,
      { configuration, rootPath: root },
    );
    if (this.currentSession !== sessionId) {
      return;
    }
    if (resolution.target === null) {
      this.debugChannel.appendLine(`Debug failed: ${resolution.error ?? 'could not resolve launch target'}`);
      this.reset();
      return;
    }

    const result: DebugStartResult = await this.bridge.invoke<DebugStartResult>(DebugChannel.Start, {
      sessionId,
      adapterId: adapter,
      rootPath: root,
    });
    if (this.currentSession !== sessionId) {
      return;
    }
    if (!result.success) {
      this.debugChannel.appendLine(`Debug failed: ${result.error ?? 'unknown error'}`);
      this.reset();
      return;
    }
    this.capabilities = (result.capabilities as DebugProtocol.Capabilities | undefined) ?? {};
    // Fire the launch request without awaiting it: the adapter answers only after it has emitted
    // `initialized` and we have replied with `configurationDone` (handled in onEvent), so awaiting here
    // before that reply would stall.
    void this.request('launch', this.launchArguments(configuration, root, resolution.target)).catch(
      (error: unknown): void => {
        if (this.currentSession === sessionId) {
          this.debugChannel.appendLine(`Debug launch failed: ${messageOf(error)}`);
          this.stop();
        }
      },
    );
  }

  /**
   * Handles an adapter event for the running session.
   * @param message The event message.
   */
  private onEvent(message: DebugEventMessage): void {
    if (message.sessionId !== this.currentSession) {
      return;
    }
    switch (message.event) {
      case 'initialized':
        // The adapter is ready for configuration: send the breakpoints, then signal completion.
        void this.configure();
        break;
      case 'output':
        this.appendOutput(message.body as DebugProtocol.OutputEvent['body'] | undefined);
        break;
      case 'stopped': {
        const body: DebugProtocol.StoppedEvent['body'] | undefined =
          message.body as DebugProtocol.StoppedEvent['body'] | undefined;
        this.threadId = body?.threadId ?? this.threadId;
        this.stateSignal.set('stopped');
        void this.refreshCallStack();
        break;
      }
      case 'continued':
        this.clearInspection();
        this.stateSignal.set('running');
        break;
      case 'exited': {
        const body: DebugProtocol.ExitedEvent['body'] | undefined =
          message.body as DebugProtocol.ExitedEvent['body'] | undefined;
        this.debugChannel.appendLine(`Debuggee exited with code ${body?.exitCode ?? 0}.`);
        break;
      }
      case 'terminated':
        this.debugChannel.appendLine('Debug session ended.');
        this.stop();
        break;
      default:
        break;
    }
  }

  /**
   * Handles the adapter process exiting: resets when it belongs to the running session.
   * @param exit The adapter-exit message.
   */
  private onAdapterExit(exit: DebugAdapterExit): void {
    if (exit.sessionId === this.currentSession) {
      this.reset();
    }
  }

  /**
   * Completes configuration once the adapter reports `initialized`: sends the workspace's breakpoints,
   * then signals that configuration is done so the adapter starts (or resumes to) the debuggee.
   */
  private async configure(): Promise<void> {
    await this.syncBreakpoints();
    if (this.capabilities.supportsConfigurationDoneRequest === true) {
      void this.request('configurationDone');
    }
  }

  /**
   * Sends every file's breakpoints to the adapter, including files that have lost all their breakpoints
   * (so they are cleared), and records the definition signature so the sync effect does not resend them.
   */
  private async syncBreakpoints(): Promise<void> {
    this.lastSyncSignature = definitionSignature(this.breakpoints.all());
    const paths: Set<string> = new Set<string>([
      ...this.syncedPaths,
      ...this.breakpoints.paths(),
    ]);
    for (const path of paths) {
      await this.syncFile(path);
    }
  }

  /**
   * Sends one file's enabled breakpoints to the adapter and applies the verification it returns. A file
   * with no enabled breakpoints sends an empty list, clearing it on the adapter.
   * @param path The absolute file path.
   */
  private async syncFile(path: string): Promise<void> {
    const enabled: readonly Breakpoint[] = this.breakpoints
      .forPath(path)
      .filter((breakpoint: Breakpoint): boolean => breakpoint.enabled);
    if (enabled.length === 0) {
      this.syncedPaths.delete(path);
    } else {
      this.syncedPaths.add(path);
    }
    const args: DebugProtocol.SetBreakpointsArguments = {
      source: { path },
      breakpoints: enabled.map(
        (breakpoint: Breakpoint): DebugProtocol.SourceBreakpoint => ({
          line: breakpoint.line,
          condition: breakpoint.condition,
          logMessage: breakpoint.logMessage,
        }),
      ),
    };
    try {
      const body: DebugProtocol.SetBreakpointsResponse['body'] =
        await this.request<DebugProtocol.SetBreakpointsResponse['body']>('setBreakpoints', args);
      this.breakpoints.applyVerification(
        path,
        (body?.breakpoints ?? []).map((breakpoint: DebugProtocol.Breakpoint) => ({
          line: breakpoint.line,
          verified: breakpoint.verified,
        })),
      );
    } catch {
      // A failed setBreakpoints leaves the file's breakpoints unverified; nothing more to do.
    }
  }

  /**
   * Streams an adapter `output` event into the workspace Output channel.
   * @param body The output event body.
   */
  private appendOutput(body: DebugProtocol.OutputEvent['body'] | undefined): void {
    if (body !== undefined && typeof body.output === 'string' && body.output.length > 0) {
      // The adapter's output already carries its own newlines, so append it verbatim.
      this.debugChannel.append(body.output);
    }
  }

  /**
   * Issues an execution-control step, when the debuggee is paused.
   * @param command The DAP step command (`next`, `stepIn`, or `stepOut`).
   */
  private step(command: 'next' | 'stepIn' | 'stepOut'): void {
    if (this.stateSignal() !== 'stopped') {
      return;
    }
    this.stateSignal.set('running');
    void this.request(command, { threadId: this.threadId ?? DEFAULT_THREAD_ID });
  }

  /**
   * Fetches the stopped thread's call stack, selects the top frame, and loads its scopes. Called when the
   * adapter reports the debuggee stopped.
   */
  private async refreshCallStack(): Promise<void> {
    const threadId: number = this.threadId ?? DEFAULT_THREAD_ID;
    try {
      const body: DebugProtocol.StackTraceResponse['body'] = await this.request<
        DebugProtocol.StackTraceResponse['body']
      >('stackTrace', { threadId, startFrame: 0, levels: MAX_STACK_FRAMES });
      const frames: readonly DebugFrame[] = (body?.stackFrames ?? []).map(toFrame);
      this.callStackSignal.set(frames);
      const top: DebugFrame | undefined = frames[0];
      this.currentFrameSignal.set(top?.id ?? null);
      this.locationSignal.set(locationOf(top));
      if (top !== undefined) {
        await this.loadScopes(top.id);
      } else {
        this.scopesSignal.set([]);
      }
    } catch {
      // A failed stackTrace leaves the call stack empty; the session is still usable.
      this.clearInspection();
    }
  }

  /**
   * Selects a stack frame, loading its scopes and moving the paused-location marker to it, so the user
   * can inspect an outer frame without resuming.
   * @param frameId The frame id to select.
   */
  public async selectFrame(frameId: number): Promise<void> {
    if (this.stateSignal() !== 'stopped') {
      return;
    }
    this.currentFrameSignal.set(frameId);
    this.locationSignal.set(
      locationOf(this.callStackSignal().find((frame: DebugFrame): boolean => frame.id === frameId)),
    );
    await this.loadScopes(frameId);
  }

  /**
   * Loads a frame's variable scopes into the scopes signal.
   * @param frameId The frame id to load scopes for.
   */
  private async loadScopes(frameId: number): Promise<void> {
    try {
      const body: DebugProtocol.ScopesResponse['body'] = await this.request<
        DebugProtocol.ScopesResponse['body']
      >('scopes', { frameId });
      this.scopesSignal.set(
        (body?.scopes ?? []).map(
          (scope: DebugProtocol.Scope): DebugScope => ({
            name: scope.name,
            variablesReference: scope.variablesReference,
            expensive: scope.expensive,
          }),
        ),
      );
    } catch {
      this.scopesSignal.set([]);
    }
  }

  /**
   * Fetches the child variables of a scope or structured variable, for lazy expansion of the variable
   * tree.
   * @param variablesReference The reference to fetch children for.
   * @returns Returns the child variables, or an empty list when none or on failure.
   */
  public async variables(variablesReference: number): Promise<readonly DebugVariable[]> {
    if (variablesReference <= 0) {
      return [];
    }
    try {
      const body: DebugProtocol.VariablesResponse['body'] = await this.request<
        DebugProtocol.VariablesResponse['body']
      >('variables', { variablesReference });
      return (body?.variables ?? []).map(toVariable);
    } catch {
      return [];
    }
  }

  /**
   * Evaluates a watch expression against the selected frame.
   * @param expression The expression to evaluate.
   * @returns Returns the evaluation, with a failure flag when the adapter rejected it.
   */
  public async evaluate(expression: string): Promise<DebugEvaluation> {
    try {
      const body: DebugProtocol.EvaluateResponse['body'] = await this.request<
        DebugProtocol.EvaluateResponse['body']
      >('evaluate', {
        expression,
        frameId: this.currentFrameSignal() ?? undefined,
        context: 'watch',
      });
      return {
        result: body?.result ?? '',
        variablesReference: body?.variablesReference ?? 0,
        failed: false,
      };
    } catch (error: unknown) {
      return { result: messageOf(error), variablesReference: 0, failed: true };
    }
  }

  /**
   * Clears the inspection state (call stack, scopes, selected frame, paused location), used when the
   * debuggee resumes or the session ends.
   */
  private clearInspection(): void {
    this.callStackSignal.set([]);
    this.scopesSignal.set([]);
    this.currentFrameSignal.set(null);
    this.locationSignal.set(null);
  }

  /**
   * Sends a DAP request to the running session's adapter.
   * @param command The DAP request command.
   * @param args The request arguments, or undefined when the command takes none.
   * @returns Returns the adapter's response body.
   */
  private request<T = unknown>(command: string, args?: unknown): Promise<T> {
    const id: string | null = this.currentSession;
    if (this.bridge === undefined || id === null) {
      return Promise.reject(new Error('No active debug session'));
    }
    return this.bridge.invoke<T>(DebugChannel.Request, id, command, args);
  }

  /**
   * Builds the DAP `launch` request body from a run configuration and its resolved launch target (the
   * built program the provider located). The target's program, working directory, arguments, and
   * environment take precedence over the configuration's, which supplies only the fallbacks.
   * @param configuration The run configuration to debug.
   * @param root The workspace root, used as the default working directory.
   * @param target The resolved launch target.
   * @returns Returns the launch arguments.
   */
  private launchArguments(
    configuration: RunConfiguration,
    root: string,
    target: DebugLaunchTarget,
  ): Record<string, unknown> {
    return {
      request: 'launch',
      name: configuration.name,
      type: configuration.providerKind,
      program: target.program,
      args: target.args ?? configuration.args,
      cwd: target.cwd ?? configuration.cwd ?? root,
      env: target.env ?? configuration.env,
      // Adapters that honour runInTerminal host the debuggee in the workspace's run terminal (real
      // stdin, coloured output); the rest run it under their own console, stdout/stderr arriving as
      // `output` events this session routes into the Logs channel.
      console: RUN_IN_TERMINAL_ADAPTERS.has(this.activeAdapterId)
        ? 'integratedTerminal'
        : 'internalConsole',
      noDebug: false,
    };
  }

  /**
   * Hosts the debuggee in this workspace's reused debug run terminal, answering an adapter's relayed
   * `runInTerminal` request with the spawned process id so it can attach. External terminals are
   * declined; the run session gives the program real stdin and the familiar exit banner.
   * @param message The relayed request.
   */
  private async onRunInTerminal(message: DebugRunInTerminalRequest): Promise<void> {
    if (message.sessionId !== this.currentSession) {
      return;
    }
    const respond: (answer: Omit<DebugRunInTerminalResponse, 'sessionId' | 'seq'>) => void = (
      answer: Omit<DebugRunInTerminalResponse, 'sessionId' | 'seq'>,
    ): void => {
      void this.bridge?.invoke(DebugChannel.RespondRunInTerminal, {
        sessionId: message.sessionId,
        seq: message.seq,
        ...answer,
      });
    };
    if (message.kind === 'external' || message.args.length === 0) {
      respond({ error: 'External terminals are not supported.' });
      return;
    }
    const [command, ...argv] = message.args;
    // A null value asks for the variable to be unset — unsupported over the layered environment, so
    // only real values travel.
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(message.env ?? {}).filter(
        (entry: [string, string | null]): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    this.debugTerminalId ??= `debug-term-${crypto.randomUUID()}`;
    const launch: TerminalLaunch = await this.terminals.launch({
      sessionId: this.debugTerminalId,
      name: `Debug: ${this.activeConfigurationName.length > 0 ? this.activeConfigurationName : command}`,
      kind: 'run',
      command,
      args: argv,
      env,
      cwd: message.cwd.length > 0 ? message.cwd : undefined,
    });
    if (launch.processId === null) {
      respond({ error: 'The debuggee could not be started in a terminal.' });
      return;
    }
    this.debugTerminalLive = true;
    void launch.exited.then((): void => {
      this.debugTerminalLive = false;
    });
    respond({ processId: launch.processId });
  }

  /**
   * Stops the debug terminal's process when the session ends while it still runs, so no debuggee is
   * orphaned when the adapter does not tear it down itself.
   */
  private stopDebugTerminal(): void {
    if (this.debugTerminalId !== null && this.debugTerminalLive) {
      this.debugTerminalLive = false;
      this.terminals.terminate(this.debugTerminalId);
    }
  }

  /**
   * Resets to the idle, no-session state, clearing the breakpoints' (transient) verification and the
   * synchronisation bookkeeping so the next session re-sends them.
   */
  private reset(): void {
    this.stopDebugTerminal();
    this.currentSession = null;
    this.threadId = undefined;
    this.capabilities = {};
    this.lastSyncSignature = '';
    this.syncedPaths.clear();
    this.breakpoints.clearVerification();
    this.clearInspection();
    this.stateSignal.set('idle');
  }
}

/**
 * Maps an adapter stack frame to the UI frame, resolving its source path (absent for a runtime frame).
 * @param frame The adapter frame.
 * @returns Returns the UI frame.
 */
function toFrame(frame: DebugProtocol.StackFrame): DebugFrame {
  return {
    id: frame.id,
    name: frame.name,
    path: frame.source?.path ?? null,
    line: frame.line,
    column: frame.column,
  };
}

/**
 * Maps an adapter variable to the UI variable.
 * @param variable The adapter variable.
 * @returns Returns the UI variable.
 */
function toVariable(variable: DebugProtocol.Variable): DebugVariable {
  return {
    name: variable.name,
    value: variable.value,
    type: variable.type ?? null,
    variablesReference: variable.variablesReference,
  };
}

/**
 * Derives the paused source location from a stack frame, or null when the frame has no source path.
 * @param frame The frame, or undefined when the stack is empty.
 * @returns Returns the location, or null.
 */
function locationOf(frame: DebugFrame | undefined): DebugLocation | null {
  if (frame?.path == null) {
    return null;
  }
  return { path: frame.path, line: frame.line, column: frame.column };
}

/**
 * Extracts a human-readable message from an unknown error.
 * @param error The error value.
 * @returns Returns the message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Builds an order-independent signature of every breakpoint's definition (excluding the transient
 * verification), so a re-sync can be skipped when only verification changed.
 * @param all The breakpoints keyed by file path.
 * @returns Returns the signature.
 */
function definitionSignature(all: ReadonlyMap<string, readonly Breakpoint[]>): string {
  const parts: string[] = [];
  for (const [path, list] of all) {
    for (const breakpoint of list) {
      parts.push(
        `${path}:${breakpoint.line}:${breakpoint.condition ?? ''}:${breakpoint.logMessage ?? ''}:${
          breakpoint.enabled ? 1 : 0
        }`,
      );
    }
  }
  return parts.sort().join('|');
}
