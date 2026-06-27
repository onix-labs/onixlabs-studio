import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  untracked,
} from '@angular/core';
import { ProjectModel } from '../../../../shared/project-system';
import { DirectoryListing, RepositoryInfo, SourceControlApi } from '../../../../shared/studio-api';
import { Icon } from '../../../icons/icon';
import { CodeTerminals } from '../../../services/code-terminals/code-terminals';
import { Diagnostics } from '../../../services/diagnostics/diagnostics';
import { DiffOpener } from '../../../services/diffs/diff-opener';
import { Diffs } from '../../../services/diffs/diffs';
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockFloating } from '../../../services/dock/dock-floating';
import { DockFocus } from '../../../services/dock/dock-focus';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { StackNode } from '../../../services/dock/dock-node';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { DockState } from '../../../services/dock/dock-state';
import { DockTabContext } from '../../../services/dock/dock-tab-context';
import { collectPanelIds, findStackOfPanel } from '../../../services/dock/dock-tree';
import { Documents } from '../../../services/documents/documents';
import { FileOpener } from '../../../services/file-opener/file-opener';
import { LspClient } from '../../../services/lsp/lsp-client';
import { SolutionModel } from '../../../services/project/solution-model';
import { Output } from '../../../services/output/output';
import { RepositoryOpener } from '../../../services/repositories/repository-opener';
import { Repository } from '../../../services/repository/repository';
import {
  WorkspaceSourceControlCommandHandler,
  WorkspaceSourceControlCommands,
} from '../../../services/workspace-source-control-commands/workspace-source-control-commands';
import { BuildRunner } from '../../../services/tasks/build-runner';
import { Builds } from '../../../services/tasks/builds';
import { ActiveWorkspace } from '../../../services/workspace/active-workspace';
import { Workspace } from '../../../services/workspace/workspace';
import { WorkspaceGit } from '../../../services/workspace-git/workspace-git';
import { Workspaces } from '../../../services/workspaces/workspaces';
import { CommitDetail } from '../source-control-view/panels/commit-detail/commit-detail';
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
    BuildRunner,
    LspClient,
    SolutionModel,
    FileOpener,
    WorkspaceGit,
    Repository,
    Diffs,
    DiffOpener,
    DockTabContext,
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
   * Holds the global active-workspace seam this tab publishes its open folder to, so the status
   * strip's language-server menu can scope itself to this workspace while the tab is active.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds this tab's scoped dock layout.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds this tab's scoped solution model, whose presence drives the Solution Explorer panel.
   */
  private readonly solutionModel: SolutionModel = inject(SolutionModel);

  /**
   * Holds this tab's scoped language-server client, started eagerly for a .NET solution.
   */
  private readonly lspClient: LspClient = inject(LspClient);

  /**
   * Holds whether this tab has added the Solution Explorer panel to its layout, so it is added and
   * removed at most once per state change and a user who closes it is not fought.
   */
  private solutionShown: boolean = false;

  /**
   * Holds this tab's scoped document model.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds this tab's lightweight git status, refreshed when the tab is shown so the explorers'
   * change decorations stay current.
   */
  private readonly workspaceGit: WorkspaceGit = inject(WorkspaceGit);

  /**
   * Holds the (root) docked run-terminal store, swept alongside the documents it shadows.
   */
  private readonly codeTerminals: CodeTerminals = inject(CodeTerminals);

  /**
   * Holds this tab's scoped build runner, registered as the active build handler while the tab is
   * active so the root ribbon's build actions reach this workspace.
   */
  private readonly buildRunner: BuildRunner = inject(BuildRunner);

  /**
   * Holds the root build seam this tab registers its runner with while active.
   */
  private readonly builds: Builds = inject(Builds);

  /**
   * Holds this tab's scoped repository model, bound lazily to the workspace's git repository the first
   * time a source-control action is taken, and powering the reused commit panel and push/pull.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds this tab's scoped diff store, swept of diffs whose dock panels have been closed.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds the root source-control command seam this tab registers its handler with while active, so
   * the directory ribbon's Source Control group reaches this workspace.
   */
  private readonly workspaceSourceControl: WorkspaceSourceControlCommands = inject(
    WorkspaceSourceControlCommands,
  );

  /**
   * Holds the (root) repository opener used to open this workspace's repository in the source-control
   * view.
   */
  private readonly repositoryOpener: RepositoryOpener = inject(RepositoryOpener);

  /**
   * Holds this tab's dock focus tracker, used to accent the dock when the commit panel is revealed.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds this tab's dock panel registry, used to register the reused commit panel on first use.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds this tab's dock context, carrying its id and rooted folder to the docked terminal panel.
   */
  private readonly dockTabContext: DockTabContext = inject(DockTabContext);

  /**
   * Holds the git bridge, used to resolve and open this workspace's repository for the scoped
   * {@link Repository}; undefined when running outside Electron.
   */
  private readonly sourceControlApi: SourceControlApi | undefined = window.studio?.sourceControl;

  /**
   * Holds whether the reused commit panel has been registered with this tab's dock, so it is added at
   * most once.
   */
  private commitRegistered: boolean = false;

  /**
   * Holds the source-control command handler this tab registers while active, exposing the workspace's
   * everyday git actions (open in source control, commit, push, pull) to the directory ribbon.
   */
  private readonly sourceControlHandler: WorkspaceSourceControlCommandHandler = {
    hasRepository: this.workspaceGit.isRepository,
    openInSourceControl: (): void => this.openInSourceControl(),
    commit: (): void => void this.revealCommit(),
    push: (): void => void this.pushOrPull('push'),
    pull: (): void => void this.pushOrPull('pull'),
  };

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

    effect((): void => {
      if (this.isActive()) {
        this.builds.register(this.buildRunner);
      } else {
        this.builds.unregister(this.buildRunner);
      }
    });

    // Register this workspace's source-control handler while active, so the directory ribbon's Source
    // Control group (open in source control, commit, push, pull) reaches this tab's repository.
    effect((): void => {
      if (this.isActive()) {
        this.workspaceSourceControl.register(this.sourceControlHandler);
      } else {
        this.workspaceSourceControl.unregister(this.sourceControlHandler);
      }
    });

    // Drop diff records once their dock tab is gone, so closed diffs (opened from the commit panel)
    // are not retained.
    effect((): void => {
      const present: ReadonlySet<string> = new Set<string>(
        collectPanelIds(this.dockState.layout()),
      );
      this.diffs.removeMissing(present);
    });

    // Refresh the explorers' git decorations whenever the tab is shown, catching changes made while
    // it was in the background.
    effect((): void => {
      if (this.isActive()) {
        void this.workspaceGit.refresh();
      }
    });

    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      this.activeWorkspace.setRoot(this.tabId(), root);
      this.dockTabContext.setRoot(root);
    });

    // Show the Solution Explorer only while this tab's root has a recognised project system, docking it
    // beside the File Explorer; remove it when the model goes away. The layout reads/writes are
    // untracked so the effect reacts to the model alone, not to unrelated dock rearrangements.
    effect((): void => {
      const hasModel: boolean = this.solutionModel.model() !== null;
      untracked((): void => this.syncSolutionPanel(hasModel));
    });

    // Start the language server as soon as a .NET solution opens, rather than on the first file, so it
    // begins loading the workspace up front.
    effect((): void => {
      const model: ProjectModel | null = this.solutionModel.model();
      if (model?.kind === 'dotnet') {
        untracked((): void => this.lspClient.prestartServer('csharp', model.root));
      }
    });
  }

  /**
   * Adds or removes the Solution Explorer panel to match whether a project model is present, tabbing it
   * into the File Explorer's stack when shown.
   * @param hasModel Whether this tab currently has a project model.
   */
  private syncSolutionPanel(hasModel: boolean): void {
    if (hasModel && !this.solutionShown) {
      const filesStack: StackNode | null = findStackOfPanel(this.dockState.layout(), 'files');
      if (filesStack !== null) {
        this.dockState.tabInto(filesStack.id, 'solution');
        this.solutionShown = true;
      }
    } else if (!hasModel && this.solutionShown) {
      this.dockState.removeFromLayout('solution');
      this.solutionShown = false;
    }
  }

  /**
   * Seeds the scoped workspace from the folder stashed for this tab, when opened from the welcome
   * screen.
   */
  public ngOnInit(): void {
    this.documents.setOwningTab(this.tabId());
    this.dockTabContext.setTabId(this.tabId());
    const initial: DirectoryListing | undefined = this.workspaces.takeInitial(this.tabId());
    if (initial !== undefined) {
      this.workspace.openListing(initial);
    }
  }

  /**
   * Closes the workspace folder when the tab is torn down, releasing its root in the main process.
   */
  public ngOnDestroy(): void {
    this.builds.unregister(this.buildRunner);
    this.workspaceSourceControl.unregister(this.sourceControlHandler);
    this.activeWorkspace.clearRoot(this.tabId());
    this.workspaceGit.dispose();
    if (this.repository.isBound()) {
      void this.repository.close();
    }
    void this.workspace.closeFolder();
  }

  /**
   * Opens this workspace's repository in the full source-control view (a new tab, reused when already
   * open). A no-op when no folder is open.
   */
  private openInSourceControl(): void {
    const path: string | undefined = this.workspace.root()?.path;
    if (path !== undefined) {
      void this.repositoryOpener.openFolder(path);
    }
  }

  /**
   * Binds the scoped repository (lazily, on first use) then reveals the reused commit panel in this
   * tab's dock.
   * @returns Returns a promise that resolves once the panel has been revealed (or the bind failed).
   */
  private async revealCommit(): Promise<void> {
    if (!(await this.ensureRepository())) {
      return;
    }
    if (!this.commitRegistered) {
      this.registry.register({
        id: 'commit',
        title: 'Commit',
        icon: Icon.LIST_ALL,
        role: 'tool',
        component: CommitDetail,
      });
      this.commitRegistered = true;
    }
    if (!collectPanelIds(this.dockState.layout()).includes('commit')) {
      const filesStack: StackNode | null = findStackOfPanel(this.dockState.layout(), 'files');
      if (filesStack !== null) {
        this.dockState.tabInto(filesStack.id, 'commit');
      }
    }
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), 'commit');
    if (stack !== null) {
      this.dockState.setActive(stack.id, 'commit');
      this.dockFocus.focus(stack.id);
    }
  }

  /**
   * Binds the scoped repository (lazily, on first use) then pushes or pulls the current branch,
   * refreshing the explorers' change decorations afterwards.
   * @param op The operation to run.
   * @returns Returns a promise that resolves once the operation has settled.
   */
  private async pushOrPull(op: 'push' | 'pull'): Promise<void> {
    if (!(await this.ensureRepository())) {
      return;
    }
    await (op === 'push' ? this.repository.push() : this.repository.pull());
    await this.workspaceGit.refresh();
  }

  /**
   * Ensures the scoped repository is bound to this workspace's git repository, resolving and opening it
   * once. The resolve takes an independent reference-counted hold on the root, balanced by
   * {@link Repository.close} on teardown.
   * @returns Returns true when a repository is bound, or false when the folder is not a repository.
   */
  private async ensureRepository(): Promise<boolean> {
    if (this.repository.isBound()) {
      return true;
    }
    const path: string | undefined = this.workspace.root()?.path;
    if (path === undefined) {
      return false;
    }
    const info: RepositoryInfo | null = await (this.sourceControlApi?.resolveRepository(path) ??
      Promise.resolve(null));
    if (info === null) {
      return false;
    }
    // A concurrent action may have bound it while resolving; balance this resolve's extra hold.
    if (this.repository.isBound()) {
      void this.sourceControlApi?.closeRepository(info.root);
      return true;
    }
    this.repository.bind(info);
    return true;
  }
}
