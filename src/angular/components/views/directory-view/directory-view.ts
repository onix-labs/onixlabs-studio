import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { DirectoryListing } from '../../../../shared/studio-api';
import { CodeTerminals } from '../../../services/code-terminals/code-terminals';
import { Diagnostics } from '../../../services/diagnostics/diagnostics';
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockFloating } from '../../../services/dock/dock-floating';
import { DockFocus } from '../../../services/dock/dock-focus';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { DockState } from '../../../services/dock/dock-state';
import { collectPanelIds } from '../../../services/dock/dock-tree';
import { Documents } from '../../../services/documents/documents';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { LspClient } from '../../../services/lsp/lsp-client';
import { Output } from '../../../services/output/output';
import { Workspace } from '../../../services/workspace/workspace';
import { Workspaces } from '../../../services/workspaces/workspaces';
import { DockContainer } from '../../dock/dock-container/dock-container';

/**
 * Hosts one workspace as a top-level directory tab: a complete IDE instance with its own dock,
 * explorer, document well, and panels. The workspace's state services are provided here so each
 * directory tab is independent of the others; the dock and everything inside it resolve this tab's
 * instances. On init the tab seeds its workspace from any folder stashed for it (when opened from
 * the welcome screen); a tab opened blank shows the explorer's "open a folder" prompt instead.
 */
@Component({
  selector: 'app-directory-view',
  imports: [DockContainer],
  templateUrl: './directory-view.html',
  styleUrl: './directory-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    Workspace,
    Documents,
    Output,
    Diagnostics,
    LspClient,
    FileOpener,
    DockState,
    DockGeometry,
    DockFocus,
    DockPanelRegistry,
    DockFloating,
    DockAutoHide,
    DockDrag,
  ],
})
export class DirectoryView implements OnInit, OnDestroy {
  /**
   * Gets the owning tab's id, used to claim this workspace's stashed initial folder.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds this tab's scoped workspace.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the global registry that hands off the initial folder for this tab.
   */
  private readonly workspaces: Workspaces = inject(Workspaces);

  /**
   * Holds this tab's scoped dock layout.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds this tab's scoped document model.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the (root) docked run-terminal store, swept alongside the documents it shadows.
   */
  private readonly codeTerminals: CodeTerminals = inject(CodeTerminals);

  /**
   * Initializes a new instance of the {@link DirectoryView} class, wiring the document cleanup that
   * releases a well document once its dock panel has actually been closed (a panel that is merely
   * split or moved stays in the layout, so its document is kept). A removed document's docked
   * run-terminal state is swept too, so it does not linger in the root store.
   */
  public constructor() {
    effect((): void => {
      const present: ReadonlySet<string> = new Set<string>(
        collectPanelIds(this.dockState.layout()),
      );
      for (const id of this.documents.removeMissing(present)) {
        this.codeTerminals.remove(id);
      }
    });
  }

  /**
   * Seeds the scoped workspace from the folder stashed for this tab, when opened from the welcome
   * screen.
   */
  public ngOnInit(): void {
    this.documents.setOwningTab(this.tabId());
    const initial: DirectoryListing | undefined = this.workspaces.takeInitial(this.tabId());
    if (initial !== undefined) {
      this.workspace.openListing(initial);
    }
  }

  /**
   * Closes the workspace folder when the tab is torn down, releasing its root in the main process.
   */
  public ngOnDestroy(): void {
    void this.workspace.closeFolder();
  }
}
