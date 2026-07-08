import { InjectionToken, Signal } from '@angular/core';
import { PanelArrangement, PanelEdge } from './panel-types';

/**
 * The contract a {@link PanelLayout} exposes to the {@link Panel}s projected into it. Panels
 * resolve their placement, flex share and divider through this token rather than injecting the
 * layout class directly, which keeps the two components free of a circular import.
 */
export interface PanelLayoutContext {
  /**
   * Gets the layout's live arrangement.
   */
  readonly arrangement: Signal<PanelArrangement>;

  /**
   * Gets the main-axis flex shares of the layout's panels, keyed by panel identifier. A panel
   * without an entry takes an equal share.
   */
  readonly shares: Signal<Readonly<Record<string, number>>>;

  /**
   * Gets the identifier of the panel whose leading divider is being dragged, or null when none is.
   */
  readonly activeDivider: Signal<string | null>;

  /**
   * Gets the visible panels stacked on an edge, in order.
   * @param edge The edge to read.
   * @returns Returns the visible panel identifiers on the edge.
   */
  visibleStack(edge: PanelEdge): readonly string[];

  /**
   * Begins a divider drag between a panel and its predecessor in the stack, adjusting the two
   * panels' main-axis shares as the pointer moves.
   * @param panelId The identifier of the panel whose leading divider was pressed.
   * @param event The originating mouse event.
   */
  beginDividerDrag(panelId: string, event: MouseEvent): void;
}

/**
 * Injects the owning {@link PanelLayout}'s context into a projected panel.
 */
export const PANEL_LAYOUT_CONTEXT: InjectionToken<PanelLayoutContext> =
  new InjectionToken<PanelLayoutContext>('PANEL_LAYOUT_CONTEXT');
