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
import {
  WorkspaceDocumentCommandHandler,
  WorkspaceDocumentCommands,
} from '@features/workspace/angular/workspace-document-commands/workspace-document-commands';
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
import { PackageModel } from '@features/workspace/angular/project/package-model';
import { PackageExplorer } from '@features/workspace/angular/project/package-explorer';
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
import { WorkspaceRunConfigurations } from '@shared/angular/services/studio/workspace-run-configurations';
import { expandRunConfiguration, RunConfiguration } from '@shared/api/studio';
import { ActiveRun } from '@shared/angular/services/tasks/builds';
import { createMinimumHold, MinimumHold } from '@shared/angular/services/minimum-hold/minimum-hold';
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
 * How long a view must stay hidden before its language servers are released. Long enough that tab
 * flipping never churns servers; short enough that a parked checkout stops holding a multi-gigabyte
 * server for the rest of the session. Follow-up: make this configurable alongside
 * `ai.agentSessionLifetime`.
 */
const HIDDEN_LSP_REAP_MS: number = 10 * 60_000;

/**
 * The minimum time the Mission Control Run button shows its launching spinner after a press. A fast
 * toolchain (an already-warm `npm run`) can start its terminal near-instantly, which would flash the
 * spinner past too quickly to register; holding it for this long makes the press always read as "it
 * heard me and is starting" before settling into Stop.
 */
const RUN_SPINNER_MINIMUM_MS: number = 5_000;

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
    WorkspaceRunConfigurations,
    {
      // Give the build runner this workspace's project model so a run configuration's
      // provider-default command resolves real targets (a .NET project name to its file).
      provide: RUN_PROJECT_MODEL,
      useFactory: (): Signal<ProjectModel | null> => inject(SolutionModel).model,
    },
    DebugSession,
    LspClient,
    SolutionModel,
    PackageModel,
    PackageExplorer,
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
   * Holds the path the focus-follow effect last revealed, so dock and document churn that leaves the
   * active document unchanged re-runs no reveal walk.
   */
  private lastRevealedPath: string | null = null;

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
   * Holds this view's live agent, whose running state a checkout sub-view publishes to the
   * Worktrees panel's activity glyphs.
   */
  private readonly agent: Agent = inject(Agent);

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
    // Mission Control's per-agent Run button runs this workspace's default configuration in this
    // workspace's own build runner (not the active one) — so a background workspace's agent can be
    // launched without flipping to its tab. Read through closures for the same field-initializer
    // reason as the branch above.
    run: {
      defaultConfiguration: (): RunConfiguration | null =>
        this.workspaceRunConfigurations.defaultConfiguration(),
      starting: (): boolean => this.defaultRunStarting(),
      running: (): boolean => this.defaultRunRunning(),
      run: (): void => this.runDefaultConfiguration(),
      stop: (): void => this.stopDefaultConfiguration(),
    },
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
   * Holds this tab's scoped package model, whose presence drives the Package Management panel.
   */
  private readonly packageModel: PackageModel = inject(PackageModel);

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
   * Holds this tab's scoped reader of its own `.studio` run configurations, so Mission Control's
   * per-agent Run button can resolve and launch this workspace's default even while the tab is not the
   * active one.
   */
  private readonly workspaceRunConfigurations: WorkspaceRunConfigurations = inject(
    WorkspaceRunConfigurations,
  );

  /**
   * Gets the leaf task ids the default configuration launches: itself, or a compound default's
   * resolved members — the ids the in-flight and launching runs are matched against.
   */
  private readonly defaultRunLeafIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> => {
      const configuration: RunConfiguration | null =
        this.workspaceRunConfigurations.defaultConfiguration();
      if (configuration === null) {
        return new Set<string>();
      }
      return new Set<string>(
        expandRunConfiguration(configuration, this.workspaceRunConfigurations.configurations()).map(
          (leaf: RunConfiguration): string => leaf.id,
        ),
      );
    },
  );

  /**
   * Holds the minimum-duration latch on the Run button's spinner, so a near-instant launch still
   * shows a spinner long enough to register the press.
   */
  private readonly runStartingHold: MinimumHold = createMinimumHold(RUN_SPINNER_MINIMUM_MS);

  /**
   * Gets whether the default configuration is launching (dispatched, terminal not yet started), for
   * the Run button's spinner — held on for a minimum window after a press so a fast start still reads
   * as one.
   */
  private readonly defaultRunStarting: Signal<boolean> = computed((): boolean => {
    if (this.runStartingHold.active()) {
      return true;
    }
    const ids: ReadonlySet<string> = this.defaultRunLeafIds();
    const launching: ReadonlySet<string> = this.buildRunner.launchingTasks();
    for (const id of ids) {
      if (launching.has(id)) {
        return true;
      }
    }
    return false;
  });

  /**
   * Gets whether the default configuration has a run in flight, for the Run button's Stop state.
   */
  private readonly defaultRunRunning: Signal<boolean> = computed((): boolean => {
    const ids: ReadonlySet<string> = this.defaultRunLeafIds();
    return this.buildRunner.activeRuns().some((run: ActiveRun): boolean => ids.has(run.taskId));
  });

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
   * Holds the document-command seam the directory ribbon's File group dispatches through.
   */
  private readonly workspaceDocuments: WorkspaceDocumentCommands =
    inject(WorkspaceDocumentCommands);

  /**
   * Holds the document command handler this tab registers while active, exposing this view-scoped
   * {@link Documents} instance's well to the directory ribbon's Save and Save All.
   */
  private readonly documentHandler: WorkspaceDocumentCommandHandler = {
    canSave: computed((): boolean => this.documents.activeDocumentId() !== null),
    hasUnsavedChanges: computed((): boolean => this.documents.dirtyCount() > 0),
    save: (): void => void this.documents.saveActive(),
    saveAll: (): void => void this.documents.saveAll(),
  };

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
   * Holds this workspace's repository command handler — the repo-global remainder behind the
   * ribbon's Source Control group. Branch, stash-entry, and per-change actions are not here: the
   * Repository and Commit panels own those and reach this view's {@link Repository} directly.
   */
  private readonly repositoryCommandHandler: SourceControlCommandHandler = {
    fetch: (): void => void this.repository.fetch(),
    stash: (): void => void this.repository.stash(),
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
      const root: DirectoryListing | null = this.workspace.root();
      if (!this.isActive() || root === null) {
        this.statusBar.clearOwner(owner);
        return;
      }
      // The workspace segment: the open folder, always shown while the workspace is in view — whether
      // or not it is a git repository. A checkout's directory is a GUID, so a container tab names the
      // container instead.
      const workspaceName: string =
        this.containerName() ?? root.name ?? this.repository.repoName();
      const leading: StatusSegment[] = [
        { id: 'ws-folder', text: workspaceName, icon: Icon.FOLDER_SIMPLE, title: workspaceName },
      ];
      // The git segments follow, only when the folder is a repository: branch, then the commits to
      // push and to pull, left to right.
      if (this.repository.isBound()) {
        const branch: GitBranch | undefined = this.repository.currentBranch();
        // The worktree indicator: which checkout the container tab is scoped to. Shown only when it
        // says something the branch segment does not (an alias) — an unaliased checkout's label IS
        // its branch, and "main main" is noise.
        if (this.worktreeSession.isContainer()) {
          const label: string | null = this.worktreeSession.activeLabel();
          if (label !== null && label !== (branch?.name ?? '')) {
            leading.push({ id: 'ws-worktree', text: label, icon: Icon.WORKTREE, title: label });
          }
        }
        const branchName: string = branch?.name ?? 'detached HEAD';
        leading.push({
          id: 'ws-branch',
          text: branchName,
          icon: Icon.BRANCH,
          title: `On branch ${branchName}`,
        });
        if (branch !== undefined) {
          leading.push(
            {
              id: 'ws-push',
              text: `${branch.ahead}`,
              icon: Icon.COMMITS_AHEAD,
              title: `${branch.ahead} commit(s) to push`,
            },
            {
              id: 'ws-pull',
              text: `${branch.behind}`,
              icon: Icon.COMMITS_BEHIND,
              title: `${branch.behind} commit(s) to pull`,
            },
          );
        }
      }
      this.statusBar.contribute(owner, { leading, trailing: [] }, STATUS_PRIORITY);
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

    // The view's display label — "Baz (main)": the container name for a checkout (its directory is
    // a GUID, never shown), else the folder name, plus the live branch. Surfaces titled per view
    // (the solution explorer root, pop-out windows) read it from the dock context.
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      if (root === null) {
        this.dockTabContext.setDisplayName(null);
        return;
      }
      const base: string =
        this.containerName() ??
        root
          .split(/[\\/]/)
          .filter((part: string): boolean => part.length > 0)
          .pop() ??
        root;
      const branch: string | null = this.workspaceGit.branch();
      const suffix: string =
        branch !== null ? ` (${branch})` : this.workspaceGit.isRepository() ? ' (detached)' : '';
      this.dockTabContext.setDisplayName(`${base}${suffix}`);
    });

    // Show the Solution Explorer only while this tab's root has a recognised project system, docking it
    // beside the File Explorer; remove it when the model goes away. The layout reads/writes are
    // untracked so the effect reacts to the model alone, not to unrelated dock rearrangements.
    effect((): void => {
      const hasModel: boolean = this.solutionModel.model() !== null;
      untracked((): void => this.syncSolutionPanel(hasModel));
    });

    // Show the Package Management panel only while this tab's root has a recognised package ecosystem,
    // docking it beside the File Explorer; remove it when the model goes away. Layout reads/writes are
    // untracked so the effect reacts to the model alone.
    effect((): void => {
      const hasModel: boolean = this.packageModel.model() !== null;
      untracked((): void => this.syncPackagesPanel(hasModel));
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
    // Only for the VISIBLE view: this component is kept alive per tab and per worktree checkout, and
    // prestarting for every hidden instance would run one multi-gigabyte server per checkout at
    // once. A hidden view prestarts when it becomes active (this effect re-runs on activation).
    effect((): void => {
      const model: ProjectModel | null = this.solutionModel.model();
      const serverId: string | null =
        model === null ? null : (PRESTART_SERVERS[model.kind] ?? null);
      if (model !== null && serverId !== null && this.isActive()) {
        untracked((): void => this.lspClient.prestartServer(serverId, model.root));
      }
    });

    // Release a long-hidden view's language servers, and bring them back on activation. A worktree
    // container keeps every visited checkout's view alive with its own LSP client; without a reap,
    // each visited checkout would hold its own live server (Roslyn on a big solution is easily
    // multi-gigabyte) for the life of the tab. Mirrors the agent sessions' idle-reap idea.
    effect((onCleanup: (fn: () => void) => void): void => {
      if (this.isActive()) {
        untracked((): void => this.lspClient.resume());
        return;
      }
      const reapTimer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        this.lspClient.suspend();
      }, HIDDEN_LSP_REAP_MS);
      onCleanup((): void => clearTimeout(reapTimer));
    });

    // Focus follows the active document: when a document in the well becomes active, reveal and
    // select it in the File Explorer and the Solution Explorer, expanding the folders on the way.
    // The effect's sources fire on every dock mutation and every document open/close; the reveal
    // walks (tree expansion, solution-model scan, DOM scroll) only run when the ACTIVE PATH actually
    // changed.
    effect((): void => {
      const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
      const activeId: string | null = well?.active ?? null;
      if (activeId === null) {
        return;
      }
      const path: string | null = this.documents.get(activeId)?.filePath() ?? null;
      if (path === null || path === this.lastRevealedPath) {
        return;
      }
      this.lastRevealedPath = path;
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
          { id: 'workspace.saveAll', command: (): void => void this.documents.saveAll() },
        ]);
        this.workspaceFind.register(this.revealSearchHandler);
        this.workspaceDocuments.register(this.documentHandler);
      } else {
        this.keybindings.deactivate(this.viewScope());
        this.workspaceFind.unregister(this.revealSearchHandler);
        this.workspaceDocuments.unregister(this.documentHandler);
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
   * Adds or removes the Package Management panel to match whether a package model is present, tabbing
   * it into the bottom tool group alongside the Error List, Terminal, and Logs when shown (without
   * stealing the active tab from the user). Mirrors {@link syncSolutionPanel}: presence is derived from
   * the live layout so a tab's close/reopen does not accumulate duplicates.
   * @param hasModel Whether this tab currently has a package model.
   */
  private syncPackagesPanel(hasModel: boolean): void {
    const present: boolean = collectPanelIds(this.dockState.layout()).includes('packages');
    if (hasModel && !present) {
      const anchor: StackNode | null =
        findStackOfPanel(this.dockState.layout(), 'errors') ??
        findStackOfPanel(this.dockState.layout(), 'terminal') ??
        firstStackOfRole(this.dockState.layout(), 'tool');
      if (anchor === null) {
        return;
      }
      const previous: string | null = anchor.active;
      this.dockState.tabInto(anchor.id, 'packages');
      if (previous !== null) {
        this.dockState.setActive(anchor.id, previous);
      }
    } else if (!hasModel && present) {
      this.dockState.removeFromLayout('packages');
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
    // A checkout sub-view publishes its agent's running state to the Worktrees panel, so the
    // panel's activity glyph mirrors the SAME live agent Mission Control does.
    const checkout: string | null = this.checkoutId();
    if (checkout !== null) {
      this.destroyRef.onDestroy(
        this.worktreeSession.registerAgentActivity(checkout, this.agent.isRunning),
      );
    }
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
    this.runStartingHold.dispose();
    this.builds.unregister(this.buildRunner);
    this.debugger.unregister(this.debugSession);
    this.workspaceSourceControl.unregister(this.sourceControlHandler);
    this.keybindings.forget(this.viewScope());
    this.workspaceFind.unregister(this.revealSearchHandler);
    this.workspaceDocuments.unregister(this.documentHandler);
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
   * Runs this workspace's default run configuration in its own build runner, for Mission Control's
   * per-agent Run button. A no-op when no default is designated (the button is hidden in that case, so
   * this only guards a race). The workspace's other configurations are passed as siblings so a default
   * that is a compound resolves its members.
   */
  private runDefaultConfiguration(): void {
    const configuration: RunConfiguration | null =
      this.workspaceRunConfigurations.defaultConfiguration();
    if (configuration === null) {
      return;
    }
    // Latch the spinner first, so a near-instant launch still shows one long enough to register.
    this.runStartingHold.begin();
    this.buildRunner.runConfiguration(
      configuration,
      this.workspaceRunConfigurations.configurations(),
    );
  }

  /**
   * Stops the default configuration's in-flight runs (each member, for a compound default), for
   * Mission Control's per-agent Stop button. A no-op when nothing of it is running.
   */
  private stopDefaultConfiguration(): void {
    const ids: ReadonlySet<string> = this.defaultRunLeafIds();
    for (const run of this.buildRunner.activeRuns()) {
      if (ids.has(run.taskId)) {
        this.buildRunner.cancel(run.id);
      }
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
        ownsToolStrip: true,
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
