import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '../../../../icons/icon';
import { LspServer, LspServerState, LspStatus } from '../../../../services/lsp/lsp-status';
import { ActiveWorkspace } from '../../../../services/workspace/active-workspace';
import { AppIcon } from '../../../shared/icon/app-icon';

/**
 * Summarises the language servers of the active workspace for the status strip's trigger button.
 */
interface LspSummary {
  /**
   * Gets the overall state, favouring an in-progress start, then a ready server, then an unavailable one.
   */
  readonly state: LspServerState;

  /**
   * Gets the trigger label: the single server's description, or a count when several are running.
   */
  readonly label: string;

  /**
   * Gets the icon shown on the trigger.
   */
  readonly icon: Icon;
}

/**
 * The status strip's language-server control: a drop-up menu listing every language server running
 * for the active workspace, each with its live state (a spinner while it loads, a tick once ready, a
 * warning when unavailable) and a restart action. It replaces the single-server text indicator so the
 * several servers a workspace runs at once are all visible and individually restartable. The trigger
 * button summarises them and is hidden when the active workspace runs none.
 */
@Component({
  selector: 'app-status-strip-lsp-menu',
  imports: [AppIcon, CdkMenuTrigger, CdkMenu],
  templateUrl: './status-strip-lsp-menu.html',
  styleUrl: './status-strip-lsp-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripLspMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the language-server status registry.
   */
  private readonly lspStatus: LspStatus = inject(LspStatus);

  /**
   * Holds the active-workspace seam used to scope the list to the workspace in view.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Gets the language servers running for the active workspace, or an empty list when it runs none.
   */
  protected readonly servers: Signal<readonly LspServer[]> = computed((): readonly LspServer[] => {
    const rootPath: string | null = this.activeWorkspace.rootPath();
    if (rootPath === null) {
      return [];
    }
    return this.lspStatus
      .servers()
      .filter((server: LspServer): boolean => server.rootPath === rootPath);
  });

  /**
   * Gets the summary shown on the trigger button, or null when the active workspace runs no servers
   * (so the trigger is hidden).
   */
  protected readonly summary: Signal<LspSummary | null> = computed((): LspSummary | null => {
    const servers: readonly LspServer[] = this.servers();
    if (servers.length === 0) {
      return null;
    }
    const state: LspServerState = servers.some(
      (server: LspServer): boolean => server.state === 'starting',
    )
      ? 'starting'
      : servers.some((server: LspServer): boolean => server.state === 'ready')
        ? 'ready'
        : 'unavailable';
    // The trigger names the category, not the individual servers, since the menu can list several;
    // each server's own name and state are shown in the list it opens.
    return { state, label: 'Language Servers', icon: this.iconFor(state) };
  });

  /**
   * Gets the position that opens the menu upward from the trigger, its left edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
  ];

  /**
   * Restarts a server through the registry, which tears its session down and re-opens its documents.
   * @param server The server to restart.
   */
  protected restart(server: LspServer): void {
    this.lspStatus.restart(server.sessionId);
  }

  /**
   * Gets the icon for a server state.
   * @param state The server state.
   * @returns Returns the matching icon.
   */
  protected iconFor(state: LspServerState): Icon {
    switch (state) {
      case 'starting':
        return Icon.SPINNER;
      case 'ready':
        return Icon.SUCCESS;
      default:
        return Icon.WARNING;
    }
  }

  /**
   * Gets the short status text shown against a server row.
   * @param server The server to describe.
   * @returns Returns the status text.
   */
  protected statusText(server: LspServer): string {
    switch (server.state) {
      case 'starting':
        return 'Starting…';
      case 'ready':
        return 'Ready';
      default:
        return server.detail ?? 'Unavailable';
    }
  }

}
