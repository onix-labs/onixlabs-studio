import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  untracked,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import {
  AGENT_CONVERSATION_CONTEXT,
  ConversationContextResolver,
  GLOBAL_CONVERSATION_CONTEXT,
} from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { ProjectModel } from '@shared/api/project-system';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { RepositoryInfo, SourceControlClient } from '@shared/api/source-control-channels';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { Icon } from '@shared/angular/icons/icon';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { Diagnostics } from '@shared/angular/services/diagnostics/diagnostics';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { WorkspaceFind } from '@features/workspace/angular/workspace-find/workspace-find';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  collectPanelIds,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { Documents } from '@shared/angular/services/documents/documents';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { LspClient } from '@shared/angular/services/lsp/lsp-client';
import { SolutionModel } from '@features/workspace/angular/project/solution-model';
import { Output } from '@shared/angular/services/output/output';
import { RepositoryOpener } from '@shared/angular/services/repositories/repository-opener';
import { Repository } from '@shared/angular/services/repository/repository';
import {
  WorkspaceSourceControlCommandHandler,
  WorkspaceSourceControlCommands,
} from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { BuildRunner } from '@shared/angular/services/tasks/build-runner';
import { Builds } from '@shared/angular/services/tasks/builds';
import { Debugger } from '@shared/angular/services/debug/debugger';
import { DebugSession } from '@features/workspace/angular/debug/debug-session';
import { WorkspaceCapabilities } from '@shared/angular/services/workspace/workspace-capabilities';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { CommitDetail } from '@shared/angular/components/panels/commit-detail/commit-detail';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { WORKSPACE_DOCK_BLUEPRINT } from './workspace-dock-blueprint';

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
    DebugSession,
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
    { provide: DOCK_BLUEPRINT, useValue: WORKSPACE_DOCK_BLUEPRINT },
    // The agent conversation lives at this view's level, not in the dock's agent panel: tool stacks
    // destroy an inactive panel when another activates, and a conversation scoped to the panel would
    // lose its transcript and in-flight run on every switch. Here it lives as long as the tab.
    Agent,
    AgentConversation,
    {
      // Scope agent conversations docked in this IDE to the open workspace root (or the global bucket
      // when the tab has no folder open yet). Resolved lazily so it tracks the workspace loading.
      provide: AGENT_CONVERSATION_CONTEXT,
      useFactory: (): ConversationContextResolver => {
        const workspace: Workspace = inject(Workspace);
        return (): ConversationContext => {
          const path: string | undefined = workspace.root()?.path;
          return path === undefined
            ? GLOBAL_CONVERSATION_CONTEXT
            : { kind: 'workspace', key: path };
        };
      },
    },
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
   * Holds this tab's agent-host registrar, so the workspace agent appears in Mission Control for the
   * tab's whole life — not only while its docked agent panel is the active dock tool. Finalised in
   * {@link ngOnInit} once the tab id is readable.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'editor',
  });

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
   * Holds this tab's scoped document model.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the app-wide unsaved-work registry this view-scoped {@link Documents} registers into, so the
   * tab close and the window close prompt for the well's unsaved documents (the root injector cannot
   * see this per-view instance through the static provider).
   */
  private readonly unsavedWork: UnsavedWorkRegistry = inject(UnsavedWorkRegistry);

  /**
   * Holds the destroy notifier used to unregister from the unsaved-work registry when the tab closes.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds this tab's lightweight git status, refreshed when the tab is shown so the explorers'
   * change decorations stay current.
   */
  private readonly workspaceGit: WorkspaceGit = inject(WorkspaceGit);

  /**
   * Holds the (root) docked run-terminal store, swept alongside the documents it shadows.
   */
  private readonly editorTerminals: EditorTerminals = inject(EditorTerminals);

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
   * Holds this tab's scoped debug session, registered as the active debug handler while the tab is
   * active so the root ribbon's debug actions reach this workspace.
   */
  private readonly debugSession: DebugSession = inject(DebugSession);

  /**
   * Holds the root debug seam this tab registers its session with while active.
   */
  private readonly debugger: Debugger = inject(Debugger);

  /**
   * Holds the seam routing this workspace's declared capabilities to the root ribbon while active.
   */
  private readonly workspaceCapabilities: WorkspaceCapabilities = inject(WorkspaceCapabilities);

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
   * Holds the keyboard-binding router this tab registers its find accelerator with while active.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the workspace find seam the directory ribbon's Find command routes through.
   */
  private readonly workspaceFind: WorkspaceFind = inject(WorkspaceFind);

  /**
   * Holds a stable reveal callback registered with {@link workspaceFind}, so it can be unregistered by
   * identity.
   */
  private readonly revealSearchHandler: () => void = (): void => this.revealSearch();

  /**
   * Holds this tab's dock context, carrying its id and rooted folder to the docked terminal panel.
   */
  private readonly dockTabContext: DockTabContext = inject(DockTabContext);

  /**
   * Holds the git bridge, used to resolve and open this workspace's repository for the scoped
   * {@link Repository}; undefined when running outside Electron.
   */
  private readonly sourceControlApi: SourceControlClient | undefined = inject(SourceControl).client;

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
        this.editorTerminals.remove(id);
      }
    });

    effect((): void => {
      if (this.isActive()) {
        this.builds.register(this.buildRunner);
        this.debugger.register(this.debugSession);
        this.workspaceCapabilities.register(this.solutionModel.model);
      } else {
        this.builds.unregister(this.buildRunner);
        this.debugger.unregister(this.debugSession);
        this.workspaceCapabilities.unregister(this.solutionModel.model);
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

    // Reveal the Debug panel (call stack / variables / watch) while a debug session runs, tabbing it
    // beside Output and activating it; remove it when the session ends. Layout reads/writes are untracked
    // so the effect reacts to the session state alone.
    effect((): void => {
      const running: boolean = this.debugSession.state() !== 'idle';
      untracked((): void => this.syncDebugPanel(running));
    });

    // Start the structure-aware language server as soon as a recognised project model opens, rather
    // than on the first file, so it begins loading the workspace up front: Roslyn for a .NET
    // solution, the TypeScript server for a Node/npm workspace.
    effect((): void => {
      const model: ProjectModel | null = this.solutionModel.model();
      const serverId: string | null =
        model?.kind === 'dotnet' ? 'csharp' : model?.kind === 'node' ? 'typescript' : null;
      if (model !== null && serverId !== null) {
        untracked((): void => this.lspClient.prestartServer(serverId, model.root));
      }
    });

    // Focus follows the active document: when a document in the well becomes active, reveal and
    // select it in the File Explorer and the Solution Explorer, expanding the folders on the way.
    effect((): void => {
      const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
      const activeId: string | null = well?.active ?? null;
      if (activeId === null) {
        return;
      }
      const path: string | null = this.documents.get(activeId)?.filePath() ?? null;
      if (path === null) {
        return;
      }
      untracked((): void => {
        void this.workspace.revealPath(path);
        this.solutionModel.revealPath(path);
      });
    });

    // Register the workspace find accelerator while active, so Cmd/Ctrl+Shift+F reveals the Search
    // panel in this tab's dock. Bound only while active, so background tabs do not intercept the chord.
    effect((): void => {
      if (this.isActive()) {
        this.keybindings.register(this.tabId(), [
          { id: 'workspace.findInFiles', command: (): void => this.revealSearch() },
        ]);
        this.workspaceFind.register(this.revealSearchHandler);
      } else {
        this.keybindings.deactivate(this.tabId());
        this.workspaceFind.unregister(this.revealSearchHandler);
      }
    });
  }

  /**
   * Reveals the Search panel in this tab's dock, tabbing it beside the File Explorer (falling back to
   * the agent's group) when it is not already in the layout, then activating and focusing it.
   */
  private revealSearch(): void {
    if (!collectPanelIds(this.dockState.layout()).includes('search')) {
      const anchor: StackNode | null =
        findStackOfPanel(this.dockState.layout(), 'files') ??
        findStackOfPanel(this.dockState.layout(), 'agent');
      if (anchor !== null) {
        this.dockState.tabInto(anchor.id, 'search');
      }
    }
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), 'search');
    if (stack !== null) {
      this.dockState.setActive(stack.id, 'search');
      this.dockFocus.focus(stack.id);
    }
  }

  /**
   * Adds or removes the Solution Explorer panel to match whether a project model is present, tabbing it
   * into the File Explorer's stack when shown.
   * @param hasModel Whether this tab currently has a project model.
   */
  private syncSolutionPanel(hasModel: boolean): void {
    // Derive presence from the live layout rather than a per-instance flag: the layout persists across
    // a tab's close/reopen, so a flag that resets with each DirectoryView would re-add a panel that is
    // already there, accumulating duplicates. Mirrors revealCommit's guard.
    const present: boolean = collectPanelIds(this.dockState.layout()).includes('solution');
    if (hasModel && !present) {
      const filesStack: StackNode | null = findStackOfPanel(this.dockState.layout(), 'files');
      if (filesStack !== null) {
        this.dockState.tabInto(filesStack.id, 'solution');
      }
    } else if (!hasModel && present) {
      this.dockState.removeFromLayout('solution');
    }
  }

  /**
   * Adds or removes the Debug panel to match whether a debug session is running, tabbing it beside the
   * Output panel (falling back to any tool stack) and activating it when shown.
   * @param running Whether a debug session is currently running in this tab.
   */
  private syncDebugPanel(running: boolean): void {
    const present: boolean = collectPanelIds(this.dockState.layout()).includes('debug');
    if (running && !present) {
      const anchor: StackNode | null =
        findStackOfPanel(this.dockState.layout(), 'output') ??
        firstStackOfRole(this.dockState.layout(), 'tool');
      if (anchor !== null) {
        this.dockState.tabInto(anchor.id, 'debug');
        this.dockState.setActive(anchor.id, 'debug');
      }
    } else if (!running && present) {
      this.dockState.removeFromLayout('debug');
    }
  }

  /**
   * Seeds the scoped workspace from the folder stashed for this tab, when opened from the welcome
   * screen.
   */
  public ngOnInit(): void {
    this.agentHost.register(this.tabId());
    this.documents.setOwningTab(this.tabId());
    // Surface this workspace's well documents to the app-wide close flows for the tab's lifetime.
    this.destroyRef.onDestroy(this.unsavedWork.register(this.documents));
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
    this.debugger.unregister(this.debugSession);
    this.workspaceSourceControl.unregister(this.sourceControlHandler);
    this.keybindings.forget(this.tabId());
    this.workspaceFind.unregister(this.revealSearchHandler);
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
   * tab's dock, tabbed into the agent panel's group (falling back to the file explorer's group).
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
      const anchor: StackNode | null =
        findStackOfPanel(this.dockState.layout(), 'agent') ??
        findStackOfPanel(this.dockState.layout(), 'files');
      if (anchor !== null) {
        this.dockState.tabInto(anchor.id, 'commit');
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
