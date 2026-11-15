import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  Signal,
  untracked,
} from '@angular/core';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { DockMinimums } from '@shared/angular/services/dock-layout/dock-minimums';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import { PanelPopout } from '@shared/angular/services/panel-popout/panel-popout';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { NetworkActivity } from '../network-activity/network-activity';
import { NETWORK_CAPTURE_PANEL } from '../network-captures/network-capture-panel';
import { NetworkCaptures } from '../network-captures/network-captures';
import {
  NetworkExplorerCommandHandler,
  NetworkExplorerCommands,
} from '../network-explorer-commands/network-explorer-commands';
import { NETWORK_EXPLORER_DOCK_BLUEPRINT } from '../network-explorer-dock-blueprint';
import { NETWORK_RUN_PANEL } from '../network-runs/network-run-panel';
import { NetworkRuns } from '../network-runs/network-runs';
import { NetworkWell } from '../network-well/network-well';
import { CapturePanel } from '../panels/capture-panel/capture-panel';
import { RunPanel } from '../panels/run-panel/run-panel';

/**
 * The Network Explorer tab: a dock surface for looking at the machine's network — its interfaces, the
 * connections made over them, and, as they arrive, captures of what flows through them and the tools
 * (ping, traceroute) for reaching the far end of a connection.
 *
 * Like the API and Database Explorers, the view is almost empty: it provides the dock services, the
 * blueprint naming its panels, and the network store those panels share. The services are provided
 * here rather than in the panels because a dock tool stack destroys an inactive panel when a sibling
 * activates, and the readings, the selection and the terminal's PTYs must outlive that.
 *
 * The network is read only while the tab is active: a background explorer costs nothing, and coming
 * back to one shows its last readings until fresh ones land.
 */
@Component({
  selector: 'app-network-explorer-view',
  imports: [DockContainer],
  templateUrl: './network-explorer-view.html',
  styleUrl: './network-explorer-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // The network readings and selection, and the pings and traces run from them: one each per tab,
    // shared by every panel in it.
    NetworkActivity,
    NetworkWell,
    NetworkRuns,
    { provide: NETWORK_RUN_PANEL, useValue: RunPanel },
    NetworkCaptures,
    { provide: NETWORK_CAPTURE_PANEL, useValue: CapturePanel },
    // The dock framework, instantiated per dock-hosting view.
    DockTabContext,
    DockState,
    DockGeometry,
    DockMinimums,
    DockFocus,
    DockPanelRegistry,
    DockFloating,
    DockAutoHide,
    DockDrag,
    DockReveal,
    TerminalSessions,
    PopoutPanels,
    PanelPopout,
    { provide: DOCK_BLUEPRINT, useValue: NETWORK_EXPLORER_DOCK_BLUEPRINT },
  ],
})
export class NetworkExplorerView implements OnInit, OnDestroy, NetworkExplorerCommandHandler {
  /**
   * Gets the owning tab's id.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the tab's network readings and selection.
   */
  private readonly activity: NetworkActivity = inject(NetworkActivity);

  /**
   * Holds the tab's pings and traces.
   */
  private readonly runs: NetworkRuns = inject(NetworkRuns);

  /**
   * Holds the tab's packet captures.
   */
  private readonly captures: NetworkCaptures = inject(NetworkCaptures);

  /**
   * Holds the file client, for choosing a capture file to open.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the ribbon's command registry this view registers itself with while it is active.
   */
  private readonly commands: NetworkExplorerCommands = inject(NetworkExplorerCommands);

  /**
   * Holds the dock's tab context, carrying this tab's identity to the panels inside it.
   */
  private readonly tabContext: DockTabContext = inject(DockTabContext);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether idle interfaces are listed.
   */
  public readonly showIdleInterfaces: Signal<boolean> =
    this.activity.showIdleInterfaces.asReadonly();

  /**
   * Gets whether loopback connections are listed.
   */
  public readonly showLoopback: Signal<boolean> = this.activity.showLoopback.asReadonly();

  /**
   * Reads the network, and drives the ribbon, only while this tab is the active one — so two open
   * explorers do not both sample, and the ribbon acts on the one in front.
   */
  public constructor() {
    effect((): void => {
      const active: boolean = this.isActive();
      untracked((): void => {
        if (active) {
          this.activity.open();
          this.commands.register(this);
        } else {
          this.activity.close();
          this.commands.clear(this);
        }
      });
    });
  }

  /**
   * Hands the panels this tab's identity, which the terminal keys its sessions on.
   */
  public ngOnInit(): void {
    this.tabContext.setTabId(this.tabId());
    this.log.info('network-explorer.view', 'Network Explorer opened');
  }

  /**
   * Stops reading the network, stops every ping and trace still going, stops and forgets every
   * capture, and releases the ribbon, so a closed tab drives nothing.
   */
  public ngOnDestroy(): void {
    this.activity.close();
    this.runs.stopAll();
    this.captures.releaseAll();
    this.commands.clear(this);
  }

  /**
   * Re-reads the machine's interfaces.
   */
  public refresh(): void {
    void this.activity.refresh();
  }

  /**
   * Lists idle interfaces, or stops listing them.
   */
  public toggleIdleInterfaces(): void {
    this.activity.showIdleInterfaces.update((shown: boolean): boolean => !shown);
  }

  /**
   * Lists loopback connections, or stops listing them.
   */
  public toggleLoopback(): void {
    this.activity.showLoopback.update((shown: boolean): boolean => !shown);
  }

  /**
   * Opens a capture file the user chooses, in its own document.
   */
  public async openCapture(): Promise<void> {
    const path: string | null = await this.fileSystem.pickPath('file');
    if (path !== null) {
      this.captures.openFile(path);
    }
  }
}
