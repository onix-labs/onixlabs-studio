import { Service, signal, WritableSignal } from '@angular/core';

/**
 * Identifies a binary editor side panel.
 */
export type BinaryPanelKind = 'disassembly' | 'inspector' | 'agent';

/**
 * Lists every binary side-panel kind, so state that spans all panels (such as clearing a closed tab)
 * stays in step as kinds are added.
 */
const PANEL_KINDS: readonly BinaryPanelKind[] = ['disassembly', 'inspector', 'agent'];

/**
 * Holds the state of a single binary tab's side panel.
 */
interface PanelState {
  /**
   * Gets a value indicating whether the panel is currently shown.
   */
  readonly visible: boolean;

  /**
   * Gets a value indicating whether the panel has ever been shown, and so is mounted. The panel stays
   * mounted once shown so its state survives being hidden.
   */
  readonly mounted: boolean;
}

/**
 * Holds the state assumed for a panel with no entry yet. The assembly and inspector panels are closed
 * by default, so a freshly opened binary tab shows just the hex grid until a panel is toggled on.
 */
const DEFAULT_STATE: PanelState = {
  visible: false,
  mounted: false,
};

/**
 * Owns the docked side-panel state for binary tabs — whether each tab's Disassembly, Inspector, and
 * Agent panels are shown. All dock to the side and can be open together, so there is no layout to
 * track.
 *
 * State is read reactively (templates calling these accessors re-evaluate when it changes). A panel
 * stays mounted once first shown so its state is preserved while hidden.
 */
@Service()
export class BinaryPanels {
  /**
   * Holds the panel state for every binary tab and panel kind, keyed by `tabId::kind`.
   */
  private readonly states: WritableSignal<ReadonlyMap<string, PanelState>> = signal<
    ReadonlyMap<string, PanelState>
  >(new Map<string, PanelState>());

  /**
   * Returns whether a tab's panel is currently shown.
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   * @returns Returns true when the panel is shown.
   */
  public isVisible(id: string, kind: BinaryPanelKind): boolean {
    return this.stateOf(id, kind).visible;
  }

  /**
   * Returns whether a tab's panel is mounted (has been shown at least once).
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   * @returns Returns true when the panel is mounted.
   */
  public isMounted(id: string, kind: BinaryPanelKind): boolean {
    return this.stateOf(id, kind).mounted;
  }

  /**
   * Toggles the visibility of a tab's panel.
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   */
  public toggle(id: string, kind: BinaryPanelKind): void {
    if (this.isVisible(id, kind)) {
      this.update(id, kind, { visible: false });
    } else {
      this.update(id, kind, { visible: true, mounted: true });
    }
  }

  /**
   * Hides a tab's panel, leaving it mounted so its state is preserved.
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   */
  public hide(id: string, kind: BinaryPanelKind): void {
    this.update(id, kind, { visible: false });
  }

  /**
   * Removes a tab's panel state. Called when the tab closes.
   * @param id The owning tab identifier.
   */
  public remove(id: string): void {
    const next: Map<string, PanelState> = new Map<string, PanelState>(this.states());
    for (const kind of PANEL_KINDS) {
      next.delete(this.key(id, kind));
    }
    this.states.set(next);
  }

  /**
   * Builds the map key for a tab and panel kind.
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   * @returns Returns the composite key.
   */
  private key(id: string, kind: BinaryPanelKind): string {
    return `${id}::${kind}`;
  }

  /**
   * Gets the current state for a tab's panel, falling back to the default state.
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   * @returns Returns the panel state.
   */
  private stateOf(id: string, kind: BinaryPanelKind): PanelState {
    return this.states().get(this.key(id, kind)) ?? DEFAULT_STATE;
  }

  /**
   * Applies a partial update to a tab's panel state.
   * @param id The owning tab identifier.
   * @param kind The panel kind.
   * @param patch The fields to change.
   */
  private update(id: string, kind: BinaryPanelKind, patch: Partial<PanelState>): void {
    const next: Map<string, PanelState> = new Map<string, PanelState>(this.states());
    next.set(this.key(id, kind), { ...this.stateOf(id, kind), ...patch });
    this.states.set(next);
  }
}
