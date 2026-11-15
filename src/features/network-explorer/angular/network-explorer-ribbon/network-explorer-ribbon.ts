import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Icon } from '@shared/angular/icons/icon';
import { NetworkExplorerCommands } from '../network-explorer-commands/network-explorer-commands';

/**
 * The contextual ribbon shown while a Network Explorer tab is active: refresh the interfaces, and
 * choose what the panels list. Its actions drive the active view through the
 * {@link NetworkExplorerCommands} registry.
 *
 * The Capture and Tools groups — watching an interface, ping, traceroute — join it as those arrive.
 */
@Component({
  selector: 'app-network-explorer-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripColumn,
  ],
  templateUrl: './network-explorer-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkExplorerRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the command registry the buttons drive the active view through.
   */
  protected readonly commands: NetworkExplorerCommands = inject(NetworkExplorerCommands);
}
