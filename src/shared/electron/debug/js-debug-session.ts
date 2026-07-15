import type { DebugProtocol } from '@vscode/debugprotocol';
import { DebugAdapterId } from '@shared/api/debug-channels';
import { DapClient, DebugAdapterConnection } from './dap-client';
import { DebugAdapterSpec } from './debug-adapter-registry';
import { TcpClientTransport, TcpServerTransport } from './dap-transport';

/**
 * The DAP `type` js-debug expects for a Node launch. The renderer sends the provider kind (`node`); the
 * compound session rewrites it to js-debug's own type on the parent launch.
 */
const JS_DEBUG_LAUNCH_TYPE: string = 'pwa-node';

/**
 * The commands routed to the parent (server) session rather than the active target session: the launch
 * that starts the debuggee and the disconnect/terminate that ends everything.
 */
const PARENT_COMMANDS: ReadonlySet<string> = new Set<string>([
  'launch',
  'attach',
  'disconnect',
  'terminate',
]);

/**
 * Drives a js-debug session, which — unlike a stdio adapter — is a debug *server* hosting a tree of DAP
 * connections: a parent session the debuggee is launched on, and one child *target* session per running
 * process (the main program, and any workers or child processes it spawns). js-debug asks the client to
 * start each target with a `startDebugging` reverse request; the real debugging (breakpoints, stops,
 * stacks, variables) happens on the target sessions, not the parent.
 *
 * This class hides that whole tree behind the single-session {@link DebugAdapterConnection} surface the
 * {@link import('./debug-manager').DebugManager} expects, so the renderer drives it exactly like a stdio
 * adapter. It answers the parent's `initialized`/`startDebugging` internally, surfaces only the target
 * sessions' events (forwarding the first target's `initialized` as the session's, so the renderer sends
 * breakpoints once), routes the renderer's requests to the active target, replays breakpoints to any
 * additional targets, and reports the session terminated once every target has ended.
 */
export class JsDebugSession implements DebugAdapterConnection {
  /**
   * Holds the adapter spawn specification (the Node runtime and the js-debug server script).
   */
  private readonly spec: DebugAdapterSpec;

  /**
   * Holds the absolute working directory the server is spawned in.
   */
  private readonly cwd: string;

  /**
   * Holds the transport that spawns the debug server; its host and port reach the target sessions.
   */
  private readonly serverTransport: TcpServerTransport;

  /**
   * Holds the parent session, on which the debuggee is launched and which requests targets be started.
   */
  private readonly parent: DapClient;

  /**
   * Holds the running target sessions, in the order they were started.
   */
  private readonly targets: DapClient[] = [];

  /**
   * Holds the target the renderer's requests are routed to: the one that most recently stopped.
   */
  private activeTarget: DapClient | null = null;

  /**
   * Holds the adapter id, used to initialize each target session.
   */
  private adapterId: DebugAdapterId = 'js-debug';

  /**
   * Holds whether a target's `initialized` has been surfaced to the renderer yet, so exactly one target
   * (the first) is configured by the renderer and the rest are configured internally.
   */
  private initializedForwarded: boolean = false;

  /**
   * Holds the last `setBreakpoints` arguments the renderer sent, keyed by source path, so a newly started
   * target inherits the same breakpoints.
   */
  private readonly breakpointsBySource: Map<string, unknown> = new Map<string, unknown>();

  /**
   * Holds the registered event listeners.
   */
  private readonly eventListeners: Set<(event: DebugProtocol.Event) => void> = new Set<
    (event: DebugProtocol.Event) => void
  >();

  /**
   * Holds the registered connection-close listeners.
   */
  private readonly exitListeners: Set<(code: number | null, signal: string | null) => void> =
    new Set<(code: number | null, signal: string | null) => void>();

  /**
   * Holds whether the session has reported terminated, so it is reported at most once.
   */
  private ended: boolean = false;

  /**
   * Initializes a new instance of the {@link JsDebugSession} class.
   * @param spec The adapter spawn specification (the Node runtime and js-debug server script).
   * @param cwd The absolute working directory to spawn the server in.
   */
  public constructor(spec: DebugAdapterSpec, cwd: string) {
    this.spec = spec;
    this.cwd = cwd;
    this.serverTransport = new TcpServerTransport(spec.command, spec.args, spec.env, cwd);
    this.parent = new DapClient(this.serverTransport);
  }

  /**
   * Spawns the debug server, connects the parent session, and wires its events and target requests.
   * @returns Returns a promise that resolves once the parent session is connected.
   */
  public async start(): Promise<void> {
    this.parent.onEvent((event: DebugProtocol.Event): void => this.onParentEvent(event));
    this.parent.onReverseRequest((request: DebugProtocol.Request): void =>
      this.onStartDebugging(this.parent, request),
    );
    this.parent.onExit((code: number | null, signal: string | null): void =>
      this.onServerClosed(code, signal),
    );
    await this.parent.start();
  }

  /**
   * Initializes the parent session and resolves with its advertised capabilities.
   * @param adapterId The adapter id, advertised to every session.
   * @returns Returns the parent session's capabilities.
   */
  public async initialize(adapterId: DebugAdapterId): Promise<DebugProtocol.Capabilities> {
    this.adapterId = adapterId;
    return this.parent.initialize(adapterId);
  }

  /**
   * Routes a DAP request: launch/attach and disconnect/terminate go to the parent (server) session,
   * everything else to the active target session. `setBreakpoints` is also remembered so later targets
   * inherit it.
   * @param command The DAP request command.
   * @param args The request arguments.
   * @returns Returns the response body.
   */
  public sendRequest<T = unknown>(command: string, args?: unknown): Promise<T> {
    if (command === 'launch' || command === 'attach') {
      return this.parent.sendRequest<T>(command, this.launchArguments(args));
    }
    if (PARENT_COMMANDS.has(command)) {
      return this.parent.sendRequest<T>(command, args);
    }
    if (command === 'setBreakpoints') {
      this.rememberBreakpoints(args);
    }
    const target: DapClient | null = this.activeTarget;
    if (target === null) {
      return Promise.reject(new Error('No active debug target'));
    }
    return target.sendRequest<T>(command, args);
  }

  /**
   * Registers a listener for the session's events (the surfaced target events).
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onEvent(listener: (event: DebugProtocol.Event) => void): () => void {
    this.eventListeners.add(listener);
    return (): void => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Registers a listener for the session closing (the debug server exiting).
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onExit(listener: (code: number | null, signal: string | null) => void): () => void {
    this.exitListeners.add(listener);
    return (): void => {
      this.exitListeners.delete(listener);
    };
  }

  /**
   * Tears the session down: disposes every target, then the parent (which kills the server, ending the
   * whole tree).
   */
  public dispose(): void {
    for (const target of this.targets) {
      target.dispose();
    }
    this.targets.length = 0;
    this.activeTarget = null;
    this.parent.dispose();
  }

  /**
   * Handles a parent-session event. The parent's `initialized` is answered internally with
   * `configurationDone` (so its launch resolves); its other events (telemetry output, and the like) are
   * not surfaced — only the target sessions' events are.
   * @param event The parent event.
   */
  private onParentEvent(event: DebugProtocol.Event): void {
    if (event.event === 'initialized') {
      void this.parent.sendRequest('configurationDone').catch((): void => undefined);
    }
  }

  /**
   * Handles a `startDebugging` reverse request from the parent (or a target that itself spawns a child):
   * connects a new target session, initializes it, and launches the requested configuration. The target
   * reports its `initialized` next, handled in {@link onTargetEvent}.
   * @param requester The session that made the request (parent or a target).
   * @param request The reverse request.
   */
  private onStartDebugging(requester: DapClient, request: DebugProtocol.Request): void {
    requester.respondTo(request, {});
    const args: { request?: unknown; configuration?: unknown } =
      (request.arguments as { request?: unknown; configuration?: unknown } | undefined) ?? {};
    const childRequest: string = args.request === 'attach' ? 'attach' : 'launch';
    const configuration: unknown = args.configuration ?? {};
    void this.startTarget(childRequest, configuration);
  }

  /**
   * Connects and launches a new target session for a `startDebugging` request.
   * @param request The DAP request kind to send the target (`launch` or `attach`).
   * @param configuration The target configuration js-debug supplied (carries its `__pendingTargetId`).
   */
  private async startTarget(request: string, configuration: unknown): Promise<void> {
    if (this.ended) {
      return;
    }
    const target: DapClient = new DapClient(
      new TcpClientTransport(this.serverTransport.host, this.serverTransport.port),
    );
    target.onEvent((event: DebugProtocol.Event): void => this.onTargetEvent(target, event));
    target.onReverseRequest((nested: DebugProtocol.Request): void =>
      this.onStartDebugging(target, nested),
    );
    target.onExit((): void => this.onTargetClosed(target));
    this.targets.push(target);
    try {
      await target.start();
      await target.initialize(this.adapterId);
      // The target answers its launch only after we reply to its `initialized` with
      // setBreakpoints/configurationDone, so this is deliberately not awaited.
      void target.sendRequest(request, configuration).catch((): void => undefined);
    } catch {
      this.onTargetClosed(target);
    }
  }

  /**
   * Handles a target-session event. The first target's `initialized` is surfaced to the renderer (which
   * then sends breakpoints and configurationDone, routed back to that target); every later target is
   * configured internally with the remembered breakpoints. Stops, output, and exits are surfaced;
   * termination is tracked so the session ends once every target has.
   * @param target The target the event came from.
   * @param event The target event.
   */
  private onTargetEvent(target: DapClient, event: DebugProtocol.Event): void {
    switch (event.event) {
      case 'initialized':
        if (!this.initializedForwarded) {
          this.initializedForwarded = true;
          this.activeTarget = target;
          this.forwardEvent(event);
        } else {
          void this.configureTarget(target);
        }
        break;
      case 'stopped':
        this.activeTarget = target;
        this.forwardEvent(event);
        break;
      case 'terminated':
        this.onTargetTerminated(target);
        break;
      case 'output':
      case 'continued':
      case 'exited':
        this.forwardEvent(event);
        break;
      default:
        break;
    }
  }

  /**
   * Configures a target the renderer will not configure itself (any after the first): replays the
   * remembered breakpoints, then signals configuration done so it starts running.
   * @param target The target to configure.
   */
  private async configureTarget(target: DapClient): Promise<void> {
    for (const [path, args] of this.breakpointsBySource) {
      void path;
      await target.sendRequest('setBreakpoints', args).catch((): void => undefined);
    }
    void target.sendRequest('configurationDone').catch((): void => undefined);
  }

  /**
   * Handles a target reporting terminated: drops it, and ends the session once no targets remain.
   * @param target The terminated target.
   */
  private onTargetTerminated(target: DapClient): void {
    this.dropTarget(target);
    if (this.targets.length === 0) {
      this.reportTerminated();
    }
  }

  /**
   * Handles a target's socket closing: treated like termination.
   * @param target The closed target.
   */
  private onTargetClosed(target: DapClient): void {
    this.onTargetTerminated(target);
  }

  /**
   * Removes a target from the tracked set, re-pointing the active target when it was the one removed.
   * @param target The target to remove.
   */
  private dropTarget(target: DapClient): void {
    const index: number = this.targets.indexOf(target);
    if (index < 0) {
      return;
    }
    this.targets.splice(index, 1);
    target.dispose();
    if (this.activeTarget === target) {
      this.activeTarget = this.targets[this.targets.length - 1] ?? null;
    }
  }

  /**
   * Handles the debug server process exiting: reports the session terminated (if not already) and closes.
   * @param code The server process exit code.
   * @param signal The terminating signal.
   */
  private onServerClosed(code: number | null, signal: string | null): void {
    this.reportTerminated();
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }
  }

  /**
   * Surfaces a synthetic `terminated` event to the renderer once, ending the logical session.
   */
  private reportTerminated(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.forwardEvent({ seq: 0, type: 'event', event: 'terminated' });
  }

  /**
   * Records a `setBreakpoints` request by its source path, so later targets inherit the same breakpoints.
   * A source with no breakpoints is dropped rather than replayed as an empty set.
   * @param args The `setBreakpoints` arguments.
   */
  private rememberBreakpoints(args: unknown): void {
    const request: DebugProtocol.SetBreakpointsArguments | null = asSetBreakpoints(args);
    const path: string | undefined = request?.source.path;
    if (request === null || path === undefined) {
      return;
    }
    if ((request.breakpoints ?? []).length === 0) {
      this.breakpointsBySource.delete(path);
    } else {
      this.breakpointsBySource.set(path, args);
    }
  }

  /**
   * Rewrites the renderer's launch arguments for js-debug: it expects its own launch `type`, so the
   * provider-kind type the renderer sent is replaced.
   * @param args The renderer's launch arguments.
   * @returns Returns the launch arguments to send the parent.
   */
  private launchArguments(args: unknown): unknown {
    if (typeof args !== 'object' || args === null) {
      return args;
    }
    return { ...(args as Record<string, unknown>), type: JS_DEBUG_LAUNCH_TYPE };
  }

  /**
   * Delivers an event to every registered listener.
   * @param event The event to deliver.
   */
  private forwardEvent(event: DebugProtocol.Event): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

/**
 * Narrows an unknown value to `setBreakpoints` arguments when it has a source path, or null otherwise.
 * @param args The candidate arguments.
 * @returns Returns the narrowed arguments, or null.
 */
function asSetBreakpoints(args: unknown): DebugProtocol.SetBreakpointsArguments | null {
  if (typeof args !== 'object' || args === null) {
    return null;
  }
  const candidate: { source?: { path?: unknown }; breakpoints?: unknown } = args;
  if (typeof candidate.source?.path !== 'string') {
    return null;
  }
  return args as DebugProtocol.SetBreakpointsArguments;
}
