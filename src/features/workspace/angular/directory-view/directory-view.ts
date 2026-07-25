import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  output,
  OutputEmitterRef,
  Signal,
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
  AGENT_CONVERSATION_KIND,
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
import { DOCK_BLUEPRINT, DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { restoreLayout } from '@shared/angular/services/dock-layout/dock-persistence';
import {
  LayoutPresets,
  LayoutPresetSession,
} from '@shared/angular/services/layout-presets/layout-presets';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { PanelPopout } from '@shared/angular/services/panel-popout/panel-popout';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
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
import { Repository } from '@shared/angular/services/repository/repository';
import { GitBranch } from '@shared/angular/services/repository/repository-data';
import { StatusBar, StatusSegment } from '@shared/angular/services/status-bar/status-bar';
import {
  WorkspaceSourceControlCommandHandler,
  WorkspaceSourceControlCommands,
} from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { BuildRunner } from '@shared/angular/services/tasks/build-runner';
import { RUN_PROJECT_MODEL } from '@shared/angular/services/tasks/run-project-model';
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
import { REPOSITORY_DOCK_BLUEPRINT } from '@shared/angular/components/panels/repository-dock-blueprint';
import {
  SourceControlCommandHandler,
  SourceControlCommands,
} from '@shared/angular/services/source-control-commands/source-control-commands';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

/**
 * Maps a project model's kind to the language server prestarted when its workspace opens, so the
 * structure-aware server begins loading the workspace up front rather than on the first file: Roslyn
 * for .NET, the TypeScript server for Node, jdtls for a Gradle/Maven JVM build, Pyright for Python,
 * clangd for a CMake/Make C/C++ project, rust-analyzer for a Cargo project, gopls for a Go module. A
 * kind with no entry prestarts nothing.
 */
/**
 * Names this view's status-strip contribution (ported from the retired repository view).
 */
const STATUS_OWNER: string = 'source-control';

/**
 * Orders the source-control status segments among other contributors.
 */
const STATUS_PRIORITY: number = 30;

const PRESTART_SERVERS: Readonly<Record<string, string>> = {
  dotnet: 'csharp',
  node: 'typescript',
  jvm: 'java',
  python: 'python',
  cpp: 'clangd',
  rust: 'rust',
  go: 'go',
};

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
    {
      // Give the build runner this workspace's project model so a run configuration's
      // provider-default command resolves real targets (a .NET project name to its file).
      provide: RUN_PROJECT_MODEL,
      useFactory: (): Signal<ProjectModel | null> => inject(SolutionModel).model,
    },
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
    DockReveal,
    // The terminal sessions live at this view's level, not in the dock's terminal panel: tool stacks
    // destroy an inactive panel when another activates, and sessions scoped to the panel would tear
    // every PTY down on a tool-tab switch. Here they live as long as the tab.
    TerminalSessions,
    // The pop-out seam: which panels live in their own OS windows (reveals focus those windows)
    // and the auxiliary-window coordinator that pops any panel into one.
    PopoutPanels,
    PanelPopout,
    {
      // The dock seeds from the root's ACTIVE LAYOUT PRESET rather than a persisted tree: the
      // blueprint carries no key (session layout tweaks are ephemeral by ruling — every
      // construction and reset re-applies the preset's saved definition), and createLayout reads
      // the preset store at call time so DockState.reset() is exactly "apply the active preset".
      provide: DOCK_BLUEPRINT,
      useFactory: (): DockBlueprint => {
        const presets: LayoutPresets = inject(LayoutPresets);
        const context: DockTabContext = inject(DockTabContext);
        // The unified panel catalogue: the workspace panels plus the repository view's own
        // (branches rail, history graph, commit detail) — shared-id panels (terminal, agent) keep
        // the workspace definition. Any preset may arrange any of them.
        const workspaceIds: ReadonlySet<string> = new Set<string>(
          WORKSPACE_DOCK_BLUEPRINT.panels.map((panel: DockPanel): string => panel.id),
        );
        const panels: readonly DockPanel[] = [
          ...WORKSPACE_DOCK_BLUEPRINT.panels,
          ...REPOSITORY_DOCK_BLUEPRINT.panels.filter(
            (panel: DockPanel): boolean => !workspaceIds.has(panel.id),
          ),
        ];
        const known: ReadonlySet<string> = new Set<string>(
          panels.map((panel: DockPanel): string => panel.id),
        );
        return {
          panels,
          createLayout: (): DockNode => {
            const layout: DockNode | null = presets.layoutForRoot(context.presetRoot());
            return (
              (layout !== null ? restoreLayout(layout, known) : null) ??
              WORKSPACE_DOCK_BLUEPRINT.createLayout()
            );
          },
        };
      },
    },
    // The agent conversation lives at this view's level, not in the dock's agent panel: tool stacks
    // destroy an inactive panel when another activates, and a conversation scoped to the panel would
    // lose its transcript and in-flight run on every switch. Here it lives as long as the tab.
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'workspace' },
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
   * Gets a value indicating whether the view belongs to the active tab (and, for a worktree
   * checkout's sub-view, the active checkout).
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the root listing the host resolved for this view, or null to consume the tab's stashed
   * initial folder (the pre-host behavior, kept for a blank tab whose folder is opened in-view).
   */
  public readonly listing: InputSignal<DirectoryListing | null> = input<DirectoryListing | null>(
    null,
  );

  /**
   * Gets the worktree checkout this view is scoped to, or null for an ordinary workspace view.
   * Distinguishes the sub-views sharing one tab: keybinding scopes, pop-out dispatch, and status
   * ownership key on the combined view scope rather than the raw tab id.
   */
  public readonly checkoutId: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the path layout presets are keyed on, or null to key on this view's own root. A checkout's
   * sub-view keys on its CONTAINER path, so all checkouts of one container share one preset pick.
   */
  public readonly layoutRoot: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the host's promote action, or null when promotion is unavailable (the view is already a
   * checkout inside a container, or the tab is not hosted).
   */
  public readonly promoteHandler: InputSignal<(() => void) | null> = input<(() => void) | null>(
    null,
  );

  /**
   * Emits this view's workspace root whenever it changes, so the host can re-resolve what the tab
   * is (a folder opened in-view may turn out to be a worktree container).
   */
  public readonly rootChanged: OutputEmitterRef<string | null> = output<string | null>();

  /**
   * Gets this view's unique scope id: the tab id alone for an ordinary workspace, or the tab id
   * qualified by the checkout for a container's sub-view — so sub-views sharing a tab never collide
   * on scope-keyed registries.
   */
  private readonly viewScope: Signal<string> = computed((): string => {
    const checkout: string | null = this.checkoutId();
    return checkout === null ? this.tabId() : `${this.tabId()}:${checkout}`;
  });

  /**
   * Holds the tab-level worktree session (host-provided): container state for the Worktrees panel,
   * the active-checkout selection, and host root-ownership claims.
   */
  private readonly worktreeSession: WorktreeSession = inject(WorktreeSession);

  /**
   * Holds this tab's agent-host registrar, so the workspace agent appears in Mission Control for the
   * tab's whole life — not only while its docked agent panel is the active dock tool. Finalised in
   * {@link ngOnInit} once the tab id is readable.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'editor',
    // Mission Control shows the open folder's branch beside this column's title. Read through a
    // closure because this tab's git state is constructed after this field initializer runs.
    branch: (): string | null => this.workspaceGit.branch(),
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
   * Holds this tab's dock focus tracker, used to accent the dock when the commit panel is revealed.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds this tab's dock reveal helper, used to bring the Logs panel forward when a debug session
   * starts (peeking its stack when collapsed).
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds this tab's multiplexed log surface. Watched so the demoted Logs panel joins the dock (in
   * the background) exactly when something actually logs, and stays absent when nothing has.
   */
  private readonly outputService: Output = inject(Output);

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
   * Holds this tab's terminal session store. The view announces the workspace root to it (the panel
   * never does — a session launched before the panel mounts must survive the mount), and its
   * sessions are disposed with the tab.
   */
  private readonly terminalSessions: TerminalSessions = inject(TerminalSessions);

  /**
   * Holds this tab's panel pop-out coordinator. Instantiated eagerly so it registers the pop-out
   * handler with the dock chrome before the dock first renders.
   */
  private readonly panelPopout: PanelPopout = inject(PanelPopout);

  /**
   * Holds the layout preset store this view registers its session with while active.
   */
  private readonly layoutPresets: LayoutPresets = inject(LayoutPresets);

  /**
   * Holds the status strip this view contributes branch and change segments to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds a value indicating whether the transient Git switch should return to the prior preset
   * once the change count reaches zero (the commit that motivated the switch landed).
   */
  private returnWhenCommitted: boolean = false;

  /**
   * Holds the root the active layout preset was last applied for, so the root announcement re-seeds
   * the dock exactly once per root (the dock constructed before the root was known, on the
   * default preset).
   */
  private appliedPresetRoot: string | null = null;

  /**
   * Holds the last root emitted through {@link rootChanged}, so the announcement fires only on a
   * real change (the announcing effect also re-runs on activation).
   */
  private announcedRoot: string | null | undefined = undefined;

  /**
   * Holds the disposer of the registered layout preset session, or null while inactive.
   */
  private disposeLayoutSession: (() => void) | null = null;

  /**
   * Holds the layout preset session: the preset commands capture this dock's current tree for
   * Save as…/Update through it, and re-seed the dock when a preset is selected or reset. Applying
   * first returns any popped-out panels — the incoming preset defines which panels exist.
   */
  private readonly layoutSession: LayoutPresetSession = {
    root: this.dockTabContext.presetRoot,
    capture: (): DockNode => this.dockState.layout(),
    apply: (): void => {
      this.panelPopout.returnAll();
      this.dockState.reset();
    },
  };

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
   * Holds the repository command facade behind the ribbon's Repository/Sync/Changes/Branch groups.
   */
  private readonly repositoryCommands: SourceControlCommands = inject(SourceControlCommands);

  /**
   * Holds this workspace's repository command handler. Commit REVEALS the commit panel (the
   * message is written there — workspace semantics, unlike the repository view's direct commit);
   * New Branch reveals the branches rail, whose own controls create branches, until the branch
   * dialog generalizes in P3 of #351.
   */
  private readonly repositoryCommandHandler: SourceControlCommandHandler = {
    refresh: (): void => void this.repository.refresh(),
    fetch: (): void => void this.repository.fetch(),
    pull: (): void => void this.pushOrPull('pull'),
    push: (): void => void this.pushOrPull('push'),
    stageAll: (): void => void this.repository.stageAll(),
    commit: (): void => void this.revealCommit(),
    stash: (): void => void this.repository.stash(),
    newBranch: (): void => this.revealPanel('branches'),
    toggleInlineDiff: (): void => this.diffs.toggleInline(),
    // Already a workspace: the repository view's escape hatch has no meaning here.
    openAsWorkspace: (): void => undefined,
    // Promotion is the host's structural act (the tab is rebuilt as a container around this view),
    // so the view only relays it; a checkout's sub-view gets no handler and cannot promote.
    canPromoteToWorktree: computed((): boolean => this.promoteHandler() !== null),
    promoteToWorktree: (): void => this.promoteHandler()?.(),
  };

  /**
   * Resolves the worktree container's display name (its directory basename), or null when this view
   * is not part of a container.
   * @returns Returns the container name, or null.
   */
  private containerName(): string | null {
    const root: string | null = this.worktreeSession.root();
    if (root === null) {
      return null;
    }
    return (
      root
        .split(/[\\/]/)
        .filter((part: string): boolean => part.length > 0)
        .pop() ?? null
    );
  }

  /**
   * Reveals a catalogued panel, tabbing it beside the File Explorer (falling back to the agent's
   * group) when it is not already in the layout, then activating and focusing it.
   * @param panelId The panel identifier.
   */
  private revealPanel(panelId: string): void {
    if (!collectPanelIds(this.dockState.layout()).includes(panelId)) {
      const anchor: StackNode | null =
        findStackOfPanel(this.dockState.layout(), 'files') ??
        findStackOfPanel(this.dockState.layout(), 'agent');
      if (anchor !== null) {
        this.dockState.tabInto(anchor.id, panelId);
      }
    }
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    if (stack !== null) {
      this.dockState.setActive(stack.id, panelId);
      this.dockFocus.focus(stack.id);
    }
  }

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
        // Tell the language server the document is gone (a re-parent keeps it; only a real removal
        // reaches here), so its diagnostics are dropped and it is no longer analysed.
        this.lspClient.closeDocument(id);
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

    // The built-ins: Coding is today's workspace default layout; Git is the repository view's
    // arrangement (branches rail, diff well over history, commit + agent) over the same unified
    // catalogue. Registration is idempotent, so every workspace tab may declare them.
    this.layoutPresets.registerBuiltIn({
      id: 'coding',
      name: 'Coding',
      createLayout: (): DockNode => WORKSPACE_DOCK_BLUEPRINT.createLayout(),
    });
    this.layoutPresets.registerBuiltIn({
      id: 'git',
      name: 'Git',
      createLayout: (): DockNode => REPOSITORY_DOCK_BLUEPRINT.createLayout(),
    });

    // Register this tab's layout-preset session while active, so the ribbon's VIEW group commands
    // (select, save as, update, reset…) act on this dock.
    effect((): void => {
      if (this.isActive()) {
        this.disposeLayoutSession = this.layoutPresets.register(this.layoutSession);
      } else {
        this.disposeLayoutSession?.();
        this.disposeLayoutSession = null;
      }
    });

    // The dock constructed before the root was announced, seeded with the DEFAULT preset. Once the
    // root is known, re-seed from the root's own persisted pick — but only when it differs, so the
    // common case never resets a freshly-built dock.
    effect((): void => {
      const root: string | null = this.dockTabContext.presetRoot();
      if (root === null || root === this.appliedPresetRoot) {
        return;
      }
      this.appliedPresetRoot = root;
      untracked((): void => {
        if (this.layoutPresets.activeFor(root) !== this.layoutPresets.activeFor(null)) {
          this.layoutSession.apply();
        }
      });
    });

    // Bind the scoped repository as soon as the open folder proves to be one, so the ribbon's
    // repository groups and the status segments work without the commit panel having been opened.
    effect((): void => {
      if (this.workspaceGit.isRepository()) {
        untracked((): void => void this.ensureRepository());
      }
    });

    // Return from the transient Git stage once the commit lands (every change dealt with). A
    // manual preset change clears the transient state in the store, disarming this.
    effect((): void => {
      if (
        this.returnWhenCommitted &&
        this.layoutPresets.transientActive() &&
        this.repository.isBound() &&
        this.repository.changeCount() === 0
      ) {
        this.returnWhenCommitted = false;
        untracked((): void => this.layoutPresets.returnFromTransient());
      }
    });

    // Publish branch and change status to the status strip while active (ported from the retired
    // repository view). Clears when inactive or no repository is bound. The owner is qualified by
    // the view scope: a container tab hosts several sub-views whose activation effects run in
    // creation order, so a shared owner key could be wiped by a later-created sibling deactivating.
    effect((): void => {
      const owner: string = `${STATUS_OWNER}:${this.viewScope()}`;
      if (!this.isActive() || !this.repository.isBound()) {
        this.statusBar.clearOwner(owner);
        return;
      }
      const branch: GitBranch | undefined = this.repository.currentBranch();
      const changes: number = this.repository.changeCount();
      const leading: StatusSegment[] = [
        { id: 'sc-branch', text: branch?.name ?? 'detached HEAD', icon: Icon.SOURCE_CONTROL },
      ];
      // The worktree indicator: which checkout the container tab is scoped to. The Worktrees panel
      // is the switcher; this is the always-visible answer to "which one am I looking at?".
      if (this.worktreeSession.isContainer()) {
        leading.unshift({
          id: 'sc-worktree',
          text: this.worktreeSession.activeLabel() ?? '',
          icon: Icon.WORKTREE,
        });
      }
      if (branch !== undefined && (branch.ahead > 0 || branch.behind > 0)) {
        leading.push({ id: 'sc-sync', text: `↑${branch.ahead} ↓${branch.behind}` });
      }
      const trailing: StatusSegment[] = [
        { id: 'sc-changes', text: `${changes} changed`, icon: Icon.PENCIL },
        // A checkout's directory is a GUID, so the container tab names the container instead.
        { id: 'sc-repo', text: this.containerName() ?? this.repository.repoName() },
      ];
      this.statusBar.contribute(owner, { leading, trailing }, STATUS_PRIORITY);
    });

    // Register this workspace's source-control handlers while active: the workspace facade (open
    // in source control, commit, push, pull) and the repository command facade behind the ribbon's
    // Repository/Sync/Changes/Branch groups, both reaching this tab's repository.
    effect((): void => {
      if (this.isActive()) {
        this.workspaceSourceControl.register(this.sourceControlHandler);
        this.repositoryCommands.register(this.repositoryCommandHandler);
      } else {
        this.workspaceSourceControl.unregister(this.sourceControlHandler);
        this.repositoryCommands.unregister(this.repositoryCommandHandler);
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
      // Only the visible view publishes the tab's root: a container tab hosts several sub-views
      // under one tab id, and the hidden ones must not overwrite the active checkout's root.
      if (this.isActive()) {
        this.activeWorkspace.setRoot(this.tabId(), root);
      }
      this.dockTabContext.setRoot(root);
      this.dockTabContext.setPresetRoot(this.layoutRoot());
      this.terminalSessions.setRoot(root);
      if (root !== this.announcedRoot) {
        this.announcedRoot = root;
        this.rootChanged.emit(root);
      }
    });

    // Show the Solution Explorer only while this tab's root has a recognised project system, docking it
    // beside the File Explorer; remove it when the model goes away. The layout reads/writes are
    // untracked so the effect reacts to the model alone, not to unrelated dock rearrangements.
    effect((): void => {
      const hasModel: boolean = this.solutionModel.model() !== null;
      untracked((): void => this.syncSolutionPanel(hasModel));
    });

    // Reveal the Debug panel (call stack / variables / watch) while a debug session runs, tabbing it
    // beside the Error List; remove it when the session ends. Layout reads/writes are untracked
    // so the effect reacts to the session state alone.
    effect((): void => {
      const running: boolean = this.debugSession.state() !== 'idle';
      untracked((): void => this.syncDebugPanel(running));
    });

    // Materialise the Logs panel in the background once something actually logs (an LSP server, a
    // debug session): the demoted panel is reachable exactly when it has content, and absent when it
    // has none. Joining the strip never steals the active tool from the user.
    effect((): void => {
      const hasChannels: boolean = this.outputService.channels().length > 0;
      if (hasChannels) {
        untracked((): void => this.ensureLogsPanel(false));
      }
    });

    // Start the structure-aware language server as soon as a recognised project model opens, rather
    // than on the first file, so it begins loading the workspace up front: Roslyn for a .NET
    // solution, the TypeScript server for a Node/npm workspace, jdtls for a Gradle/Maven JVM build.
    effect((): void => {
      const model: ProjectModel | null = this.solutionModel.model();
      const serverId: string | null =
        model === null ? null : (PRESTART_SERVERS[model.kind] ?? null);
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
        this.keybindings.register(this.viewScope(), [
          { id: 'workspace.findInFiles', command: (): void => this.revealSearch() },
        ]);
        this.workspaceFind.register(this.revealSearchHandler);
      } else {
        this.keybindings.deactivate(this.viewScope());
        this.workspaceFind.unregister(this.revealSearchHandler);
      }
    });

    // Keep the Worktrees panel present while this view belongs to a container: every preset apply
    // rebuilds the layout from the preset's definition, so the container's defining panel is
    // re-added (and shown) whenever it is missing.
    effect((): void => {
      if (!this.worktreeSession.isContainer()) {
        return;
      }
      const layout: DockNode = this.dockState.layout();
      if (collectPanelIds(layout).includes('worktrees')) {
        return;
      }
      const anchor: StackNode | null =
        findStackOfPanel(layout, 'files') ?? firstStackOfRole(layout, 'tool');
      if (anchor !== null) {
        untracked((): void => this.dockState.tabInto(anchor.id, 'worktrees'));
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
        findStackOfPanel(this.dockState.layout(), 'errors') ??
        firstStackOfRole(this.dockState.layout(), 'tool');
      if (anchor !== null) {
        this.dockState.tabInto(anchor.id, 'debug');
      }
      // Until runInTerminal lands, the debuggee's output arrives in the Logs channel: bring Logs
      // forward for the session's start, with the Debug panel a tab away for the first break.
      this.ensureLogsPanel(true);
    } else if (!running && present) {
      this.dockState.removeFromLayout('debug');
    }
  }

  /**
   * Ensures the demoted Logs panel is in the dock, adding it beside the Error List (in the
   * background, unless asked to bring it forward — joining the strip must not steal the active tool).
   * @param activate Whether to reveal the panel (peeking its stack when collapsed).
   */
  private ensureLogsPanel(activate: boolean): void {
    if (!collectPanelIds(this.dockState.layout()).includes('output')) {
      const anchor: StackNode | null =
        findStackOfPanel(this.dockState.layout(), 'errors') ??
        firstStackOfRole(this.dockState.layout(), 'tool');
      if (anchor === null) {
        return;
      }
      const previous: string | null = anchor.active;
      this.dockState.tabInto(anchor.id, 'output');
      if (!activate && previous !== null) {
        this.dockState.setActive(anchor.id, previous);
      }
    }
    if (activate) {
      this.dockReveal.reveal('output');
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
    // The dock context carries the VIEW scope, not the raw tab id: it feeds pop-out keybinding
    // dispatch and other per-view registries, which must not collide across a container's sub-views.
    this.dockTabContext.setTabId(this.viewScope());
    const initial: DirectoryListing | null =
      this.listing() ?? this.workspaces.takeInitial(this.tabId()) ?? null;
    if (initial !== null) {
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
    this.keybindings.forget(this.viewScope());
    this.workspaceFind.unregister(this.revealSearchHandler);
    this.statusBar.clearOwner(`${STATUS_OWNER}:${this.viewScope()}`);
    // A sub-view destroyed while its tab stays open (a removed checkout, the promotion transition)
    // must not clear the tab's published root — the successor view republishes it, but only the
    // whole tab closing should drop the entry.
    if (this.checkoutId() === null) {
      this.activeWorkspace.clearRoot(this.tabId());
    }
    this.workspaceGit.dispose();
    if (this.repository.isBound()) {
      void this.repository.close();
    }
    // A host-claimed root (the container itself, or a checkout the host registered) outlives this
    // view: release the local state and watcher, but leave the main-process root open.
    const root: string | null = this.workspace.root()?.path ?? null;
    if (root !== null && this.worktreeSession.isClaimed(root)) {
      this.workspace.releaseFolder();
    } else {
      void this.workspace.closeFolder();
    }
  }

  /**
   * Switches this tab to the Git layout preset — the unified view's source-control arrangement.
   * The standalone repository view is retired (#360); "open in source control" now means "set the
   * stage for source-control work" in place.
   */
  private openInSourceControl(): void {
    this.layoutPresets.select('git');
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
    // Ruling 6 of #351: the IDE sets the stage rather than injecting panels. Commit switches to
    // the Git preset TRANSIENTLY — the persisted pick is untouched — and returns automatically
    // once the changes it staged for reach zero (the commit landed). The panel-injection path
    // below remains for the odd case where no Git preset exists.
    if (this.layoutPresets.switchTransient('git')) {
      if (this.repository.changeCount() > 0) {
        this.returnWhenCommitted = true;
      }
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
