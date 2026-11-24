import { InjectionToken, Signal } from '@angular/core';
import { SplitDirection } from './split-direction';
import type { SplitDivider } from './split-divider/split-divider';
import type { SplitPane } from './split-pane/split-pane';

/**
 * The contract a {@link import('./split-panel/split-panel').SplitPanel} exposes to the panes inside it,
 * which reach it through a token so neither has to import the other.
 */
export interface SplitContext {
  /**
   * Gets the orientation in which the panes are laid out.
   */
  readonly dir: Signal<SplitDirection>;

  /**
   * Gets the key the panes' sizes are remembered under, or null when they are not.
   */
  readonly sizesKey: Signal<string | null>;
}

/**
 * Injects the {@link SplitContext} of the split a pane is in.
 */
export const SPLIT_CONTEXT: InjectionToken<SplitContext> = new InjectionToken<SplitContext>(
  'SPLIT_CONTEXT',
);

/**
 * Names the token a split's panes and dividers provide themselves through, so the split can query both
 * at once and know their order.
 */
export const SPLIT_PART: InjectionToken<SplitPane | SplitDivider> = new InjectionToken<
  SplitPane | SplitDivider
>('SPLIT_PART');
