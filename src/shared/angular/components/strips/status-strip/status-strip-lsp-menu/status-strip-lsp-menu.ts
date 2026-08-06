import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { LspServer, LspServerState, LspStatus } from '@shared/angular/services/lsp/lsp-status';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * The status strip's language-server control: a plain article icon that opens a drop-up menu listing
 * every language server running for the active workspace, each with its live state (a spinner while it
 * loads, a tick once ready, a warning when unavailable) and a restart action. The trigger is a static
 * icon — the several servers a workspace runs are all visible and individually restartable inside the
 * menu — and is hidden when the active workspace runs none.
 */
@Component({
  selector: 'app-status-strip-lsp-menu',
  imports: [Button, AppIcon, CdkMenuTrigger, CdkMenu],
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
   * Gets whether the active workspace runs any language servers, gating the trigger's visibility.
   */
  protected readonly hasServers: Signal<boolean> = computed(
    (): boolean => this.servers().length > 0,
  );

  /**
   * Gets the position that opens the menu upward from the trigger, its left edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['up-start'];

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
