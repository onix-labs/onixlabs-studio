import { effect, inject, OnDestroy, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { Bridge } from '@shared/api/bridge';
import {
  DebugAdapterExit,
  DebugChannel,
  DebugEventMessage,
  DebugStartResult,
} from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
import { Output } from '@shared/angular/services/output/output';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { DebugHandler, DebugState } from '@shared/angular/services/debug/debugger';
import { Breakpoint, Breakpoints } from '@shared/angular/services/debug/breakpoints';
import { SolutionModel } from '@features/workspace/angular/project/solution-model';

/**
 * The thread id execution-control requests fall back to before the adapter has reported a stopped
 * thread. Adapters that model a single thread (netcoredbg, node) use thread id 1.
 */
const DEFAULT_THREAD_ID: number = 1;

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
   * Holds this workspace's Output channel, the debuggee's output is streamed into.
   */
  private readonly output: Output = inject(Output);

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
   * Holds the session's lifecycle state.
   */
  private readonly stateSignal: WritableSignal<DebugState> = signal<DebugState>('idle');

  /**
   * Gets the session's lifecycle state.
   */
  public readonly state: Signal<DebugState> = this.stateSignal.asReadonly();

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
    if (this.bridge === undefined || this.stateSignal() !== 'idle') {
      return;
    }
    const adapter: string | undefined = this.solutionModel.capabilities()?.debug?.adapter;
    const root: string | undefined = this.workspace.root()?.path;
    if (adapter === undefined) {
      this.output.appendLine('No debug adapter is available for this workspace.');
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
    this.output.appendLine(`> Debug ${configuration.name}`);

    const result: DebugStartResult = await this.bridge.invoke<DebugStartResult>(DebugChannel.Start, {
      sessionId,
      adapterId: adapter,
      rootPath: root,
    });
    if (this.currentSession !== sessionId) {
      return;
    }
    if (!result.success) {
      this.output.appendLine(`Debug failed: ${result.error ?? 'unknown error'}`);
      this.reset();
      return;
    }
    this.capabilities = (result.capabilities as DebugProtocol.Capabilities | undefined) ?? {};
    // Fire the launch request without awaiting it: the adapter answers only after it has emitted
    // `initialized` and we have replied with `configurationDone` (handled in onEvent), so awaiting here
    // before that reply would stall.
    void this.request('launch', this.launchArguments(configuration, root)).catch(
      (error: unknown): void => {
        if (this.currentSession === sessionId) {
          this.output.appendLine(`Debug launch failed: ${messageOf(error)}`);
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
        break;
      }
      case 'continued':
        this.stateSignal.set('running');
        break;
      case 'exited': {
        const body: DebugProtocol.ExitedEvent['body'] | undefined =
          message.body as DebugProtocol.ExitedEvent['body'] | undefined;
        this.output.appendLine(`Debuggee exited with code ${body?.exitCode ?? 0}.`);
        break;
      }
      case 'terminated':
        this.output.appendLine('Debug session ended.');
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
      this.output.append(body.output);
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
   * Builds the DAP `launch` request body from a run configuration. This is the generic, provider-neutral
   * body; provider-specific resolution (the built program path and adapter-specific keys) is layered on
   * in a later phase.
   * @param configuration The run configuration to debug.
   * @param root The workspace root, used as the default working directory.
   * @returns Returns the launch arguments.
   */
  private launchArguments(configuration: RunConfiguration, root: string): Record<string, unknown> {
    return {
      request: 'launch',
      name: configuration.name,
      type: configuration.providerKind,
      program: configuration.program,
      args: configuration.args,
      cwd: configuration.cwd ?? root,
      env: configuration.env,
      // Ask the adapter to run the debuggee under its own console so its stdout/stderr arrive as
      // `output` events this session routes into the Output channel.
      console: 'internalConsole',
      noDebug: false,
    };
  }

  /**
   * Resets to the idle, no-session state, clearing the breakpoints' (transient) verification and the
   * synchronisation bookkeeping so the next session re-sends them.
   */
  private reset(): void {
    this.currentSession = null;
    this.threadId = undefined;
    this.capabilities = {};
    this.lastSyncSignature = '';
    this.syncedPaths.clear();
    this.breakpoints.clearVerification();
    this.stateSignal.set('idle');
  }
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
