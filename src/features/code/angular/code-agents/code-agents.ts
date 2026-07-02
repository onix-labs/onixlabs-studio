import { Service, signal, WritableSignal } from '@angular/core';

/**
 * Holds the panel state for a single code tab's docked agent.
 */
interface PanelState {
  /**
   * Gets a value indicating whether the agent panel is currently shown.
   */
  readonly visible: boolean;

  /**
   * Gets a value indicating whether the agent panel has ever been shown, and so is mounted. The panel
   * stays mounted once shown so its conversation survives being hidden.
   */
  readonly mounted: boolean;
}

/**
 * Holds the panel state assumed for a code tab that has no entry yet.
 */
const DEFAULT_STATE: PanelState = {
  visible: false,
  mounted: false,
};

/**
 * Owns the docked agent-panel state for code tabs: whether each tab's agent panel is shown. Unlike
 * the run terminal, the agent always docks to the side, so there is no layout to track; it can be
 * open at the same time as the terminal.
 *
 * State is read reactively (templates calling these accessors re-evaluate when it changes). The panel
 * stays mounted once first shown so its conversation is preserved while hidden.
 */
@Service()
export class CodeAgents {
  /**
   * Holds the panel state for every code tab, keyed by tab identifier.
   */
  private readonly states: WritableSignal<ReadonlyMap<string, PanelState>> = signal<
    ReadonlyMap<string, PanelState>
  >(new Map<string, PanelState>());

  /**
   * Returns whether a tab's agent panel is currently shown.
   * @param id The owning tab identifier.
   * @returns Returns true when the panel is shown.
   */
  public isVisible(id: string): boolean {
    return this.stateOf(id).visible;
  }

  /**
   * Returns whether a tab's agent panel is mounted (has been shown at least once).
   * @param id The owning tab identifier.
   * @returns Returns true when the panel is mounted.
   */
  public isMounted(id: string): boolean {
    return this.stateOf(id).mounted;
  }

  /**
   * Toggles the visibility of a tab's agent panel.
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
   * Shows a tab's agent panel, mounting it if needed.
   * @param id The owning tab identifier.
   */
  public show(id: string): void {
    this.update(id, { visible: true, mounted: true });
  }

  /**
   * Hides a tab's agent panel, leaving it mounted so its conversation is preserved.
   * @param id The owning tab identifier.
   */
  public hide(id: string): void {
    this.update(id, { visible: false });
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
