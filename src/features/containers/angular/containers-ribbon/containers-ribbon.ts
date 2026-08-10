import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { ContainersCommands } from '../containers-commands/containers-commands';

/**
 * The contextual ribbon shown while a Containers tab is active. Its actions drive the active view's
 * selected container through the {@link ContainersCommands} registry: start and stop enable by the
 * selection's running state, remove enables on any selection, and refresh is always available.
 */
@Component({
  selector: 'app-containers-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
  templateUrl: './containers-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainersRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the command registry the buttons drive the active view through.
   */
  private readonly commands: ContainersCommands = inject(ContainersCommands);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether a container is selected in the active view.
   */
  protected readonly hasSelection: Signal<boolean> = this.commands.hasSelection;

  /**
   * Gets whether the selected container is running.
   */
  protected readonly selectionRunning: Signal<boolean> = this.commands.selectionRunning;

  /**
   * Starts the selected container.
   */
  protected onStart(): void {
    this.log.info('containers.ribbon', 'Start clicked');
    this.commands.start();
  }

  /**
   * Stops the selected container.
   */
  protected onStop(): void {
    this.log.info('containers.ribbon', 'Stop clicked');
    this.commands.stop();
  }

  /**
   * Removes the selected container.
   */
  protected onRemove(): void {
    this.log.info('containers.ribbon', 'Remove clicked');
    this.commands.remove();
  }

  /**
   * Streams the selected container's logs in a terminal.
   */
  protected onLogs(): void {
    this.log.info('containers.ribbon', 'View logs clicked');
    this.commands.viewLogs();
  }

  /**
   * Opens a shell in the selected running container.
   */
  protected onShell(): void {
    this.log.info('containers.ribbon', 'Shell clicked');
    this.commands.shell();
  }

  /**
   * Refreshes the container and image lists.
   */
  protected onRefresh(): void {
    this.log.info('containers.ribbon', 'Refresh clicked');
    this.commands.refresh();
  }
}
