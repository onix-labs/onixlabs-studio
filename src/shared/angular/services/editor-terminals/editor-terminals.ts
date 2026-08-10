import { inject, Service, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Holds the panel state for a single code tab's docked run terminal.
 */
interface PanelState {
  /**
   * Gets a value indicating whether the terminal panel is currently shown.
   */
  readonly visible: boolean;

  /**
   * Gets a value indicating whether the terminal panel has ever been shown, and so is mounted. The
   * panel stays mounted once shown so its session survives being hidden.
   */
  readonly mounted: boolean;

  /**
   * Gets the command queued to run once the terminal is ready, or null when none is pending.
   */
  readonly pending: string | null;
}

/**
 * Holds the panel state assumed for a code tab that has no entry yet.
 */
const DEFAULT_STATE: PanelState = {
  visible: false,
  mounted: false,
  pending: null,
};

/**
 * Owns the docked run-terminal panel state for code tabs: whether each panel is shown and any command
 * queued to run once the terminal is ready. Where the panel docks is not state here — it belongs to
 * the shared panel layout's persisted arrangement.
 *
 * State is read reactively (templates calling these accessors re-evaluate when it changes). The panel
 * stays mounted once first shown so its terminal session is preserved while hidden.
 */
@Service()
export class EditorTerminals {
  /**
   * Holds the panel state for every code tab, keyed by tab identifier.
   */
  private readonly states: WritableSignal<ReadonlyMap<string, PanelState>> = signal<
    ReadonlyMap<string, PanelState>
  >(new Map<string, PanelState>());

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Returns whether a tab's terminal panel is currently shown.
   * @param id The owning tab identifier.
   * @returns Returns true when the panel is shown.
   */
  public isVisible(id: string): boolean {
    return this.stateOf(id).visible;
  }

  /**
   * Returns whether a tab's terminal panel is mounted (has been shown at least once).
   * @param id The owning tab identifier.
   * @returns Returns true when the panel is mounted.
   */
  public isMounted(id: string): boolean {
    return this.stateOf(id).mounted;
  }

  /**
   * Toggles the visibility of a tab's terminal panel.
   * @param id The owning tab identifier.
   */
  public toggle(id: string): void {
    if (this.isVisible(id)) {
      this.update(id, { visible: false });
    } else {
      this.show(id);
    }
  }

  /**
   * Shows a tab's terminal panel, mounting it if needed.
   * @param id The owning tab identifier.
   */
  public show(id: string): void {
    this.update(id, { visible: true, mounted: true });
  }

  /**
   * Hides a tab's terminal panel, leaving it mounted so its session is preserved.
   * @param id The owning tab identifier.
   */
  public hide(id: string): void {
    this.update(id, { visible: false });
  }

  /**
   * Queues a command to run in a tab's terminal, showing the panel.
   * @param id The owning tab identifier.
   * @param command The command to run.
   */
  public queueCommand(id: string, command: string): void {
    this.update(id, { visible: true, mounted: true, pending: command });
    this.log.info('EditorTerminals', `Queued terminal command`, id, command);
  }

  /**
   * Returns a tab's pending command without clearing it.
   * @param id The owning tab identifier.
   * @returns Returns the pending command, or null when none is queued.
   */
  public pending(id: string): string | null {
    return this.stateOf(id).pending;
  }

  /**
   * Returns and clears a tab's pending command.
   * @param id The owning tab identifier.
   * @returns Returns the pending command, or null when none is queued.
   */
  public takePending(id: string): string | null {
    const pending: string | null = this.stateOf(id).pending;
    if (pending !== null) {
      this.update(id, { pending: null });
    }
    return pending;
  }

  /**
   * Removes a tab's panel state. Called when the tab closes.
   * @param id The owning tab identifier.
   */
  public remove(id: string): void {
    const next: Map<string, PanelState> = new Map<string, PanelState>(this.states());
    next.delete(id);
    this.states.set(next);
  }

  /**
   * Gets the current state for a tab, falling back to the default state.
   * @param id The owning tab identifier.
   * @returns Returns the tab's panel state.
   */
  private stateOf(id: string): PanelState {
    return this.states().get(id) ?? DEFAULT_STATE;
  }

  /**
   * Applies a partial update to a tab's panel state.
   * @param id The owning tab identifier.
   * @param patch The fields to change.
   */
  private update(id: string, patch: Partial<PanelState>): void {
    const next: Map<string, PanelState> = new Map<string, PanelState>(this.states());
    next.set(id, { ...this.stateOf(id), ...patch });
    this.states.set(next);
  }
}
