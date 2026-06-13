import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../../shared/icon/app-icon';

/**
 * Represents a single tool shown in a dock panel's tool strip.
 */
export interface DockTool {
  /**
   * Gets the stable identifier the template tracks the tool by.
   */
  readonly id: string;

  /**
   * Gets the icon rendered for the tool.
   */
  readonly icon: Icon;

  /**
   * Gets the tooltip and accessible label for the tool.
   */
  readonly label: string;
}

/**
 * Holds the default, stubbed tools rendered when a host does not supply its own set.
 */
const DEFAULT_TOOLS: readonly DockTool[] = [
  { id: 'filter', icon: Icon.SEARCH, label: 'Filter' },
  { id: 'collapse', icon: Icon.LIST, label: 'Collapse All' },
  { id: 'refresh', icon: Icon.RECENT, label: 'Refresh' },
  { id: 'more', icon: Icon.GRID_DOTS, label: 'More Actions' },
];

/**
 * Represents the tool strip that sits beneath a dock panel's title (or tab strip, for document
 * wells). The tools are presentational stubs for now; a host can override the set through the tools
 * input, otherwise a default set is shown.
 */
@Component({
  selector: 'app-dock-tool-strip',
  imports: [AppIcon],
  templateUrl: './dock-tool-strip.html',
  styleUrl: './dock-tool-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockToolStrip {
  /**
   * Gets the tools rendered by the strip, defaulting to a stubbed set.
   */
  public readonly tools: InputSignal<readonly DockTool[]> =
    input<readonly DockTool[]>(DEFAULT_TOOLS);
}
