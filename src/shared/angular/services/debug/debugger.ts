import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { RunConfiguration } from '@shared/api/studio';

/**
 * The lifecycle state of a debug session, driving what the ribbon's debug controls offer.
 */
export type DebugState =
  /**
   * No session is running.
   */
  | 'idle'
  /**
   * A session is running and the debuggee is executing.
   */
  | 'running'
  /**
   * A session is running and the debuggee is paused (at a breakpoint, step, or pause).
   */
  | 'stopped';

/**
 * The contract a workspace's debug session exposes to the {@link Debugger} seam so the root ribbon can
 * launch and drive it. Mirrors the {@link import('../tasks/builds').BuildHandler} contract.
 */
export interface DebugHandler {
  /**
   * Gets the session's lifecycle state.
   */
  readonly state: Signal<DebugState>;

  /**
   * Launches a run configuration under the debugger.
   * @param configuration The run configuration to debug.
   */
  launch(configuration: RunConfiguration): void;

  /**
   * Resumes the paused debuggee.
   */
  continue(): void;

  /**
   * Pauses the running debuggee.
   */
  pause(): void;

  /**
   * Steps over the current line.
   */
  stepOver(): void;

  /**
   * Steps into the call at the current line.
   */
  stepIn(): void;

  /**
   * Steps out of the current function.
   */
  stepOut(): void;

  /**
   * Stops the session, terminating the debuggee.
   */
  stop(): void;
}

/**
 * Routes the root ribbon's debug actions to the active workspace's debug session, the debug counterpart
 * of the {@link import('../tasks/builds').Builds} seam.
 *
 * Each workspace's {@link import('./debug-session').DebugSession} registers as the handler while its
 * directory tab is active; the ribbon reads the exposed state and calls the action methods, which
 * forward to the registered handler (or do nothing when no workspace is active). The ribbon's Debug
 * button is wired to this seam in a later phase.
 */
@Service()
export class Debugger {
  /**
   * Holds the active workspace's debug handler, or null when no workspace is active.
   */
  private readonly handler: WritableSignal<DebugHandler | null> = signal<DebugHandler | null>(null);

  /**
   * Gets the active workspace's debug-session state.
   */
  public readonly state: Signal<DebugState> = computed(
    (): DebugState => this.handler()?.state() ?? 'idle',
  );

  /**
   * Gets whether a session is running (executing or paused).
   */
  public readonly running: Signal<boolean> = computed((): boolean => this.state() !== 'idle');

  /**
   * Gets whether the debuggee is paused and can be resumed or stepped.
   */
  public readonly stopped: Signal<boolean> = computed((): boolean => this.state() === 'stopped');

  /**
   * Registers the active workspace's debug handler.
   * @param handler The handler to register.
   */
  public register(handler: DebugHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: DebugHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Launches a run configuration under the debugger on the active workspace.
   * @param configuration The run configuration to debug.
   */
  public launch(configuration: RunConfiguration): void {
    this.handler()?.launch(configuration);
  }

  /**
   * Resumes the active workspace's paused debuggee.
   */
  public continue(): void {
    this.handler()?.continue();
  }

  /**
   * Pauses the active workspace's running debuggee.
   */
  public pause(): void {
    this.handler()?.pause();
  }

  /**
   * Steps over the current line on the active workspace.
   */
  public stepOver(): void {
    this.handler()?.stepOver();
  }

  /**
   * Steps into the call at the current line on the active workspace.
   */
  public stepIn(): void {
    this.handler()?.stepIn();
  }

  /**
   * Steps out of the current function on the active workspace.
   */
  public stepOut(): void {
    this.handler()?.stepOut();
  }

  /**
   * Stops the active workspace's session.
   */
  public stop(): void {
    this.handler()?.stop();
  }
}
