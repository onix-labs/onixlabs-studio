import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { DockAutoHide, ShelvedStack } from '../../../services/dock/dock-auto-hide';
import { DockSide } from '../../../services/dock/dock-node';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';

/**
 * A shelved stack's flyout, resolved for rendering.
 */
interface ResolvedFlyout {
  /**
   * Gets the shelved stack being flown out.
   */
  readonly stack: ShelvedStack;

  /**
   * Gets the resolved panels of the stack.
   */
  readonly panels: readonly DockPanel[];

  /**
   * Gets the active resolved panel, or undefined when none is.
   */
  readonly active: DockPanel | undefined;
}

/**
 * Renders the four auto-hide edge strips and the hover flyout. Each strip lists a button per
 * shelved panel; clicking one flies its stack out, where it can be re-docked (pinned) or its panels
 * activated and closed. Empty strips collapse away.
 */
@Component({
  selector: 'app-dock-auto-hide-strips',
  imports: [DockPanelOutlet],
  templateUrl: './dock-auto-hide-strips.html',
  styleUrl: './dock-auto-hide-strips.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockAutoHideStrips {
  /**
   * Holds the auto-hide store.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

  /**
   * Holds the registry panel ids are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Gets the application edges, in render order.
   */
  protected readonly edges: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];

  /**
   * Gets the shelved stacks grouped by edge.
   */
  protected readonly byEdge: Signal<Record<DockSide, readonly ShelvedStack[]>> = computed(
    (): Record<DockSide, readonly ShelvedStack[]> => {
      const grouped: Record<DockSide, ShelvedStack[]> = {
        left: [],
        right: [],
        top: [],
        bottom: [],
      };
      for (const stack of this.autoHide.shelved()) {
        grouped[stack.edge].push(stack);
      }
      return grouped;
    },
  );

  /**
   * Gets the resolved flyout, or null when none is open.
   */
  protected readonly flyout: Signal<ResolvedFlyout | null> = computed((): ResolvedFlyout | null => {
    const key: string | null = this.autoHide.flyoutKey();
    if (key === null) {
      return null;
    }
    const stack: ShelvedStack | undefined = this.autoHide
      .shelved()
      .find((candidate: ShelvedStack): boolean => candidate.key === key);
    if (stack === undefined) {
      return null;
    }
    const panels: readonly DockPanel[] = stack.panels
      .map((id: string): DockPanel | undefined => this.registry.get(id))
      .filter((panel: DockPanel | undefined): panel is DockPanel => panel !== undefined);
    const active: DockPanel | undefined =
      stack.active !== null ? this.registry.get(stack.active) : undefined;
    return { stack, panels, active };
  });

  /**
   * Resolves a panel's title for a strip button.
   * @param panelId The identifier of the panel.
   * @returns Returns the panel title, or the identifier when unregistered.
   */
  protected title(panelId: string): string {
    return this.registry.get(panelId)?.title ?? panelId;
  }

  /**
   * Flies a shelved stack out, activating the chosen panel.
   * @param key The key of the shelved stack.
   * @param panelId The identifier of the panel to activate.
   */
  protected showFlyout(key: string, panelId: string): void {
    this.autoHide.showFlyout(key, panelId);
  }

  /**
   * Activates a panel within the flyout.
   * @param key The key of the shelved stack.
   * @param panelId The identifier of the panel to activate.
   */
  protected activate(key: string, panelId: string): void {
    this.autoHide.setActive(key, panelId);
  }

  /**
   * Re-docks the shelved stack, removing it from the shelf.
   * @param key The key of the shelved stack.
   */
  protected unpin(key: string): void {
    this.autoHide.unpin(key);
  }

  /**
   * Closes a panel within the flyout.
   * @param key The key of the shelved stack.
   * @param panelId The identifier of the panel to close.
   */
  protected close(key: string, panelId: string): void {
    this.autoHide.closePanel(key, panelId);
  }
}
