import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Represents the placeholder body rendered for a dockable panel. It stands in for the real IDE
 * panels (solution explorer, output, properties, and so on) until those are built, so the dock
 * framework has visible content to project.
 */
@Component({
  selector: 'app-dock-panel-placeholder',
  imports: [AppIcon],
  templateUrl: './dock-panel-placeholder.html',
  styleUrl: './dock-panel-placeholder.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockPanelPlaceholder {
  /**
   * Gets the panel this placeholder renders.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();
}
