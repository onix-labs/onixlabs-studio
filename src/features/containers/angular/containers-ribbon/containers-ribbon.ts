import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import {
  RibbonMenuItem,
  RibbonStripMenuButton,
} from '@shared/angular/components/ribbon-strip/ribbon-strip-menu-button/ribbon-strip-menu-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { ContainerGroup, ContainersCommands } from '../containers-commands/containers-commands';
import { ContainersClient } from '../client/containers-client';
import { ContainersAgentPanelState } from '../containers-agent/containers-agent-panel-state';

/**
 * Describes a kind of container in the Show All and Clear dropdowns.
 */
interface GroupLabel {
  /**
   * Gets the kind of container.
   */
  readonly id: ContainerGroup;

  /**
   * Gets its name in a dropdown.
   */
  readonly label: string;
}

/**
 * Lists the kinds of container, as the Show All and Clear dropdowns name them.
 */
const CONTAINER_GROUPS: readonly GroupLabel[] = [
  { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused' },
  { id: 'stopped', label: 'Stopped' },
];

/**
 * Identifies Restart in the Start dropdown.
 */
const MENU_RESTART: string = 'restart';

/**
 * Identifies Resume in the Start dropdown.
 */
const MENU_RESUME: string = 'resume';

/**
 * Identifies Pause in the Stop dropdown.
 */
const MENU_PAUSE: string = 'pause';

/**
 * The contextual ribbon shown while a Containers tab is active. Its actions drive the active view's
 * selected container through the {@link ContainersCommands} registry: start and stop enable by the
 * selection's running state, remove enables on any selection, and refresh is always available.
 */
@Component({
  selector: 'app-containers-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton, RibbonStripMenuButton],
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
   * Holds the engine client, asked whether the engine's CLI is installed.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

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
   * Gets whether Restart and Remove have anything to act on.
   */
  protected readonly hasTargets: Signal<boolean> = this.commands.hasTargets;

  /**
   * Gets whether Start has something to do.
   */
  protected readonly canStart: Signal<boolean> = this.commands.canStart;

  /**
   * Gets whether Stop has something to do.
   */
  protected readonly canStop: Signal<boolean> = this.commands.canStop;

  /**
   * Gets whether Pause can act.
   */
  protected readonly canPause: Signal<boolean> = this.commands.canPause;

  /**
   * Gets whether Resume has something to do.
   */
  protected readonly canResume: Signal<boolean> = this.commands.canResume;

  /**
   * Gets whether the view is listing containers.
   */
  protected readonly showingContainers: Signal<boolean> = this.commands.showingContainers;

  /**
   * Gets whether the engine has answered.
   */
  protected readonly engineReady: Signal<boolean> = this.commands.engineReady;

  /**
   * Gets whether anything is hidden, so Show All has something to do.
   */
  protected readonly canShowAll: Signal<boolean> = computed(
    (): boolean =>
      this.showingContainers() && this.commands.shownGroups().size < CONTAINER_GROUPS.length,
  );

  /**
   * Gets whether Clear has something to do.
   */
  protected readonly canClear: Signal<boolean> = this.commands.canClear;

  /**
   * Gets the switches under Show All.
   */
  protected readonly showItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] =>
      CONTAINER_GROUPS.map((group: GroupLabel): RibbonMenuItem => ({
        id: group.id,
        label: `Show ${group.label}`,
        checked: this.commands.shownGroups().has(group.id),
      })),
  );

  /**
   * Gets the switches under Clear.
   */
  protected readonly selectItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] =>
      CONTAINER_GROUPS.map((group: GroupLabel): RibbonMenuItem => ({
        id: group.id,
        label: `Select ${group.label}`,
        checked: this.commands.selectedGroups().has(group.id),
        disabled: !this.commands.listedGroups().has(group.id),
      })),
  );

  /**
   * Gets the actions under Start.
   */
  protected readonly startItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] => [
      { id: MENU_RESTART, label: 'Restart', icon: Icon.RESTART, disabled: !this.hasTargets() },
      { id: MENU_RESUME, label: 'Resume', icon: Icon.PLAY_FILL, disabled: !this.canResume() },
    ],
  );

  /**
   * Gets the actions under Stop.
   */
  protected readonly stopItems: Signal<readonly RibbonMenuItem[]> = computed(
    (): readonly RibbonMenuItem[] => [
      { id: MENU_PAUSE, label: 'Pause', icon: Icon.PAUSE, disabled: !this.canPause() },
    ],
  );

  /**
   * Holds whether the docked agent is showing (#969).
   */
  private readonly agentPanel: ContainersAgentPanelState = inject(ContainersAgentPanelState);

  /**
   * Gets whether the docked agent is showing.
   */
  protected readonly agentShown: Signal<boolean> = this.agentPanel.visible;

  /**
   * Gets whether a shell can be offered at all: it needs the engine's own CLI on this machine, which
   * Studio no longer downloads (#973).
   */
  protected readonly shellAvailable: Signal<boolean> = computed(
    (): boolean => this.client.engineCli() !== null,
  );

  /**
   * Contributes this tab's menu while the containers ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'containers',
    (): readonly MenuContribution[] => [
      {
        id: 'containers',
        label: 'Containers',
        items: [
          {
            id: 'containers.start',
            label: 'Start',
            enabled: this.canStart(),
            run: (): void => this.onStart(),
          },
          {
            id: 'containers.stop',
            label: 'Stop',
            enabled: this.canStop(),
            run: (): void => this.onStop(),
          },
          {
            id: 'containers.remove',
            label: 'Remove',
            enabled: this.hasTargets(),
            run: (): void => this.onRemove(),
          },
          MENU_SEPARATOR,
          {
            id: 'containers.logs',
            label: 'Logs',
            enabled: this.hasSelection(),
            run: (): void => this.onLogs(),
          },
          ...(this.shellAvailable()
            ? [
                {
                  id: 'containers.shell',
                  label: 'Shell',
                  enabled: this.selectionRunning(),
                  run: (): void => this.onShell(),
                },
              ]
            : []),
          MENU_SEPARATOR,
          {
            id: 'containers.refresh',
            label: 'Refresh',
            binding: 'containers.refresh',
            run: (): void => this.onRefresh(),
          },
        ],
      },
    ],
  );

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
   * Restarts the selected container (#974).
   */
  private onRestart(): void {
    this.log.info('containers.ribbon', 'Restart clicked');
    this.commands.restart();
  }

  /**
   * Handles the Pull Image button.
   */
  protected onPullImage(): void {
    this.commands.pullImage();
  }

  /**
   * Handles the Run button.
   */
  protected onRunImage(): void {
    this.commands.runImage();
  }

  /**
   * Handles the Show All button.
   */
  protected onShowAll(): void {
    this.commands.showAll();
  }

  /**
   * Handles a switch under Show All.
   * @param id The kind of container.
   */
  protected onShowItem(id: string): void {
    const group: ContainerGroup = id as ContainerGroup;
    this.commands.setShown(group, !this.commands.shownGroups().has(group));
  }

  /**
   * Handles a switch under Clear.
   * @param id The kind of container.
   */
  protected onSelectItem(id: string): void {
    const group: ContainerGroup = id as ContainerGroup;
    this.commands.setSelected(group, !this.commands.selectedGroups().has(group));
  }

  /**
   * Handles the Clear button.
   */
  protected onClear(): void {
    this.commands.clear();
  }

  /**
   * Handles a choice from the Start or Stop dropdown.
   * @param id The chosen item's id.
   */
  protected onMenuItem(id: string): void {
    if (id === MENU_RESTART) {
      this.onRestart();
    } else if (id === MENU_RESUME) {
      this.onResume();
    } else if (id === MENU_PAUSE) {
      this.onPause();
    }
  }

  /**
   * Handles the Pause choice.
   */
  private onPause(): void {
    this.log.info('containers.ribbon', 'Pause clicked');
    this.commands.pause();
  }

  /**
   * Handles the Resume choice.
   */
  private onResume(): void {
    this.log.info('containers.ribbon', 'Resume clicked');
    this.commands.resume();
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

  /**
   * Shows or hides the docked agent.
   */
  protected onToggleAgent(): void {
    this.agentPanel.toggle();
  }
}
