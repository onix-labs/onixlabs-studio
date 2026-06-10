import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { StackNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';

/**
 * Identifies a request to start dragging a panel out of its stack.
 */
export interface DockDragStart {
  /**
   * Gets the identifier of the panel being dragged.
   */
  readonly panelId: string;

  /**
   * Gets the originating mouse event.
   */
  readonly event: MouseEvent;
}

/**
 * Represents a tabbed group of panels (a stack) in the dock layout. Tool stacks render a title bar
 * above the tab strip; document stacks render the tab strip on top with no title bar. Activating
 * and closing tabs drive {@link DockState} directly; floating, pinning and drag-start are surfaced
 * as outputs for the floating-window, auto-hide and tab drag-drop features to wire up.
 */
@Component({
  selector: 'app-dock-tab-group',
  imports: [DockPanelOutlet],
  templateUrl: './dock-tab-group.html',
  styleUrl: './dock-tab-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dock-tab-group--documents]': 'isDocuments()',
  },
})
export class DockTabGroup {
  /**
   * Holds the layout state activation and closing drive.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the registry panel ids are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Gets the stack this group renders.
   */
  public readonly stack: InputSignal<StackNode> = input.required<StackNode>();

  /**
   * Emits the panel identifier when the user asks to float the active panel.
   */
  public readonly floatRequested: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the stack identifier when the user asks to auto-hide (pin) the stack.
   */
  public readonly pinRequested: OutputEmitterRef<string> = output<string>();

  /**
   * Emits when the user begins dragging the group by its title bar.
   */
  public readonly dragStarted: OutputEmitterRef<DockDragStart> = output<DockDragStart>();

  /**
   * Gets a value indicating whether the stack is a document well.
   */
  protected readonly isDocuments: Signal<boolean> = computed(
    (): boolean => this.stack().role === 'document',
  );

  /**
   * Gets a value indicating whether the stack holds no panels.
   */
  protected readonly isEmpty: Signal<boolean> = computed(
    (): boolean => this.stack().panels.length === 0,
  );

  /**
   * Gets the resolved panels held by the stack, in tab order.
   */
  protected readonly panels: Signal<readonly DockPanel[]> = computed((): readonly DockPanel[] =>
    this.stack()
      .panels.map((id: string): DockPanel | undefined => this.registry.get(id))
      .filter((panel: DockPanel | undefined): panel is DockPanel => panel !== undefined),
  );

  /**
   * Gets the active panel, or undefined when the stack is empty or its active panel is unregistered.
   */
  protected readonly activePanel: Signal<DockPanel | undefined> = computed(
    (): DockPanel | undefined => {
      const active: string | null = this.stack().active;
      return active !== null ? this.registry.get(active) : undefined;
    },
  );

  /**
   * Activates the panel with the given identifier.
   * @param panelId The identifier of the panel to activate.
   */
  protected activate(panelId: string): void {
    this.dockState.setActive(this.stack().id, panelId);
  }

  /**
   * Closes the panel with the given identifier, removing it from the layout.
   * @param panelId The identifier of the panel to close.
   */
  protected close(panelId: string): void {
    this.dockState.removeFromLayout(panelId);
  }

  /**
   * Requests that the active panel be floated.
   */
  protected requestFloat(): void {
    const active: string | null = this.stack().active;
    if (active !== null) {
      this.floatRequested.emit(active);
    }
  }

  /**
   * Requests that the stack be auto-hidden.
   */
  protected requestPin(): void {
    this.pinRequested.emit(this.stack().id);
  }

  /**
   * Begins a group drag from the title bar, emitting the active panel as the drag subject.
   * @param event The originating mouse event.
   */
  protected startDrag(event: MouseEvent): void {
    const active: string | null = this.stack().active;
    if (active !== null) {
      this.dragStarted.emit({ panelId: active, event });
    }
  }
}
