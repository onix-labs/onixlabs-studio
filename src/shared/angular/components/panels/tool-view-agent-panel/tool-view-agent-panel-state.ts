import { Signal, signal, WritableSignal } from '@angular/core';

/**
 * Whether a tool view's docked agent is showing (#964), shared by the view that docks it and the ribbon
 * that toggles it. Each tool view provides its own subclass as a service. Once shown, the panel stays
 * mounted, so closing it keeps its conversation.
 */
export class ToolViewAgentPanelState {
  /**
   * Holds whether the panel has been shown.
   */
  private readonly mountedState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the panel is showing.
   */
  private readonly visibleState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the panel has been shown, after which it stays mounted.
   */
  public readonly mounted: Signal<boolean> = this.mountedState.asReadonly();

  /**
   * Gets whether the panel is showing.
   */
  public readonly visible: Signal<boolean> = this.visibleState.asReadonly();

  /**
   * Shows the panel, or hides it.
   */
  public toggle(): void {
    if (this.visibleState()) {
      this.hide();
    } else {
      this.mountedState.set(true);
      this.visibleState.set(true);
    }
  }

  /**
   * Hides the panel, keeping it mounted.
   */
  public hide(): void {
    this.visibleState.set(false);
  }
}
