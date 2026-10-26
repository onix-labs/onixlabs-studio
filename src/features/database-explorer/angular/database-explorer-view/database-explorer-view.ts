import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  Signal,
  untracked,
} from '@angular/core';
import { ConnectionField, DatabaseEngineInfo } from '@shared/api/database-engine-protocol';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';
import {
  DatabaseFiles,
  OpenDatabaseDocument,
} from '@shared/angular/services/database-files/database-files';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { DockMinimums } from '@shared/angular/services/dock-layout/dock-minimums';
import {
  DockNode,
  DockSide,
  isStackNode,
  StackNode,
} from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  collectPanelIds,
  findDocumentWell,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { DockFloating, FloatWindow } from '@shared/angular/services/dock-layout/dock-floating';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { parentDir } from '@shared/angular/services/lsp/lsp-paths';
import { PanelPopout } from '@shared/angular/services/panel-popout/panel-popout';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { UnsavedDocument } from '@shared/angular/services/unsaved-work/unsaved-work';
import { UnsavedWorkRegistry } from '@shared/angular/services/unsaved-work/unsaved-work-registry';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AGENT_CONVERSATION_CONTEXT,
  AGENT_CONVERSATION_KIND,
  ConversationContextResolver,
  GLOBAL_CONVERSATION_CONTEXT,
} from '@shared/angular/services/agent-conversations/agent-conversation-context';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import { DatabaseAgentCapabilities } from '../database-agent-capabilities/database-agent-capabilities';
import { DatabaseClient } from '../database-client/database-client';
import { DATABASE_EXPLORER_DOCK_BLUEPRINT } from '../database-explorer-dock-blueprint';
import {
  ConnectionTarget,
  DatabaseExplorerCommandHandler,
  DatabaseExplorerCommands,
  RibbonPanel,
} from '../database-explorer-commands/database-explorer-commands';
import { DatabasePrompts } from '../database-prompts/database-prompts';
import { DatabaseQueryOpener } from '../database-query-opener/database-query-opener';
import { DatabaseCompletions } from '../database-completions/database-completions';
import { DatabaseSelection, DatabaseWorkspace } from '../database-workspace/database-workspace';

/**
 * The Database Explorer tab: a dock surface for browsing databases and running queries
 * against them — a small SSMS, built from the same dock the workspace and the API Explorer use.
 *
 * As with the API Explorer, the view is almost empty: it provides the dock services, the blueprint
 * naming its panels, and the workspace they share — at the view's level, because a dock tool stack
 * destroys an inactive panel and its state with it. The one thing it renders itself is the connection
 * dialog, because the ribbon, the explorer's menu and the tree's Connect all raise it.
 */
@Component({
  selector: 'app-database-explorer-view',
  imports: [
    AppIcon,
    Button,
    ButtonRow,
    Checkbox,
    DockContainer,
    Dropdown,
    Modal,
    ModalContent,
    PasswordField,
    SettingRow,
    TextField,
  ],
  templateUrl: './database-explorer-view.html',
  styleUrl: './database-explorer-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    DatabaseClient,
    DatabaseWorkspace,
    DatabasePrompts,
    DatabaseQueryOpener,
    DatabaseCompletions,
    // The agent's in-app tools, answering for this tab for as long as it is open.
    DatabaseAgentCapabilities,
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
    { provide: DOCK_BLUEPRINT, useValue: DATABASE_EXPLORER_DOCK_BLUEPRINT },
    // The agent conversation lives at the view's level, as in every dock-hosting view, so its
    // transcript survives the agent panel being swapped out of its stack.
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'workspace' },
    {
      provide: AGENT_CONVERSATION_CONTEXT,
      useFactory: (): ConversationContextResolver => (): ConversationContext =>
        GLOBAL_CONVERSATION_CONTEXT,
    },
  ],
})
export class DatabaseExplorerView implements OnInit, OnDestroy, DatabaseExplorerCommandHandler {
  /**
   * Gets the owning tab's id.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  protected readonly Icon: typeof Icon = Icon;
  protected readonly workspace: DatabaseWorkspace = inject(DatabaseWorkspace);
  protected readonly prompts: DatabasePrompts = inject(DatabasePrompts);
  private readonly opener: DatabaseQueryOpener = inject(DatabaseQueryOpener);
  private readonly dockState: DockState = inject(DockState);
  private readonly tabContext: DockTabContext = inject(DockTabContext);
  private readonly commands: DatabaseExplorerCommands = inject(DatabaseExplorerCommands);
  private readonly databaseFiles: DatabaseFiles = inject(DatabaseFiles);
  private readonly fileSystem: FileSystem = inject(FileSystem);
  private readonly tabs: Tabs = inject(Tabs);
  private readonly unsavedWork: UnsavedWorkRegistry = inject(UnsavedWorkRegistry);
  private readonly keybindings: Keybindings = inject(Keybindings);
  private readonly log: Log = inject(Log);
  private readonly panelPopout: PanelPopout = inject(PanelPopout);
  private readonly popoutPanels: PopoutPanels = inject(PopoutPanels);
  private readonly dockFloating: DockFloating = inject(DockFloating);
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Publishes this view's injector so the status strip mounts inside it.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Registers this tab's agent with Mission Control and the requests inbox for the tab's whole life,
   * on the `database` surface. Finalised in {@link ngOnInit} once the tab id is readable.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'database',
  });

  /**
   * Holds the agent's in-app capabilities. Injected purely to instantiate them.
   */
  private readonly capabilities: DatabaseAgentCapabilities = inject(DatabaseAgentCapabilities);

  /**
   * Holds the function removing this view from the unsaved-work registry.
   */
  private releaseUnsavedWork: (() => void) | null = null;

  /**
   * Gets the id of the query open in the well.
   */
  private readonly openQueryId: Signal<string | null> = computed((): string | null => {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    const id: string | null = well?.active ?? null;
    return id !== null && this.workspace.query(id) !== undefined ? id : null;
  });

  /**
   * Gets whether the open query can run.
   */
  public readonly canExecute: Signal<boolean> = computed((): boolean => {
    const id: string | null = this.openQueryId();
    return id !== null && (this.workspace.query(id)?.connectionId ?? null) !== null;
  });

  /**
   * Gets whether the open query is running.
   */
  public readonly executing: Signal<boolean> = computed((): boolean => {
    const id: string | null = this.openQueryId();
    return id !== null && this.workspace.running().has(id);
  });

  /**
   * Gets the engines offered by the connection dialog's engine picker.
   */
  protected readonly engineOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.workspace.engines().map((engine: DatabaseEngineInfo): DropdownOption => ({
        value: engine.id,
        label: engine.displayName,
      })),
  );

  /**
   * Gets the connection the ribbon's Connection buttons act on (#1102): the one selected in the Object
   * Explorer, or the one the selected tree item belongs to; else the connection of the query in front.
   */
  public readonly connectionTarget: Signal<ConnectionTarget | null> = computed(
    (): ConnectionTarget | null => {
      const selection: DatabaseSelection | null = this.workspace.selection();
      const selected: string | null =
        selection !== null && selection.kind !== 'graph' ? selection.connectionId : null;
      const front: string | null = this.openQueryId();
      const id: string | null =
        selected ?? (front === null ? null : (this.workspace.query(front)?.connectionId ?? null));
      const connection: DatabaseConnection | undefined = this.workspace.connection(id);
      if (connection === undefined) {
        return null;
      }
      return {
        id: connection.id,
        name: connection.name,
        state: this.workspace.sessions().has(connection.id)
          ? 'open'
          : this.workspace.connecting().has(connection.id)
            ? 'connecting'
            : 'closed',
      };
    },
  );

  /**
   * Gets the tab's tool panels and whether each is showing, for the ribbon's Tools toggles.
   */
  public readonly panels: Signal<readonly RibbonPanel[]> = computed((): readonly RibbonPanel[] => {
    const present: ReadonlySet<string> = new Set<string>(collectPanelIds(this.dockState.layout()));
    const floats: readonly FloatWindow[] = this.dockFloating.floats();
    return DATABASE_EXPLORER_DOCK_BLUEPRINT.panels
      .filter((panel: DockPanel): boolean => panel.role === 'tool')
      .map((panel: DockPanel): RibbonPanel => ({
        id: panel.id,
        title: panel.title,
        icon: panel.icon,
        open:
          present.has(panel.id) ||
          this.popoutPanels.isPopped(panel.id) ||
          floats.some((float: FloatWindow): boolean => float.panelId === panel.id),
      }));
  });

  /**
   * Gets whether the document has a passphrase, for the ribbon.
   */
  public readonly hasPassphrase: Signal<boolean> = computed((): boolean =>
    this.workspace.hasPassphrase(),
  );

  /**
   * Gets whether the document's passphrase is still to be given, for the ribbon.
   */
  public readonly locked: Signal<boolean> = computed((): boolean => this.workspace.locked());

  /**
   * Gets whether the connection dialog's engine has secret fields, so it offers to remember them.
   */
  protected readonly hasSecretFields: Signal<boolean> = computed((): boolean =>
    (this.prompts.engine()?.connectionFields ?? []).some(
      (field: ConnectionField): boolean => field.secret === true,
    ),
  );

  /**
   * Keeps the tab titled after the document and marked while dirty, and binds the save chords while
   * active.
   */
  public constructor() {
    // The terminal opens in the document's folder, so `psql` or `sqlite3` beside a query starts where
    // the document is; an untitled document has no folder, and the terminal says so.
    effect((): void => {
      const path: string | null = this.workspace.filePath();
      untracked((): void => this.tabContext.setRoot(path === null ? null : parentDir(path)));
    });
    effect((): void => {
      const name: string = this.workspace.documentName();
      const dirty: boolean = this.workspace.dirty();
      const tabId: string = this.tabId();
      untracked((): void => {
        if (this.workspace.filePath() !== null) {
          this.tabs.rename(tabId, name);
        }
        this.tabs.setDirty(tabId, dirty);
      });
    });
    effect((): void => {
      const tabId: string = this.tabId();
      if (this.isActive()) {
        untracked((): void =>
          this.keybindings.register(tabId, [
            { id: 'database.save', command: (): void => this.saveDocument() },
            { id: 'database.saveAs', command: (): void => this.saveDocumentAs() },
          ]),
        );
      } else {
        untracked((): void => this.keybindings.deactivate(tabId));
      }
    });
  }

  /**
   * Registers the view, loads the document it was opened with, and reopens its first query.
   */
  public ngOnInit(): void {
    void this.capabilities;
    this.agentHost.register(this.tabId());
    this.statusHost.register(this.tabId());
    this.commands.register(this);
    this.tabContext.setTabId(this.tabId());
    const opened: OpenDatabaseDocument | undefined = this.databaseFiles.takeInitial(this.tabId());
    if (opened !== undefined) {
      this.workspace.load(opened.document, opened.path);
      this.prompts.askUnlock();
    }
    this.releaseUnsavedWork = this.unsavedWork.register(this);
    const first: DatabaseQuery | undefined = this.workspace.queries()[0];
    if (first !== undefined) {
      this.opener.open(first.id);
    }
    this.log.info('database.view', 'Database Explorer opened', { file: this.workspace.filePath() });
  }

  /**
   * Releases the registrations and closes every session the tab opened.
   */
  public ngOnDestroy(): void {
    this.commands.clear(this);
    this.keybindings.forget(this.tabId());
    this.releaseUnsavedWork?.();
    void this.workspace.closeAll();
  }

  /**
   * Lists the document as unsaved work when it has unwritten edits.
   * @returns Returns the dirty document, or nothing.
   */
  public dirtyDocuments(): readonly UnsavedDocument[] {
    return this.workspace.dirty()
      ? [{ id: this.tabId(), name: this.workspace.documentName() }]
      : [];
  }

  /**
   * Lists the document as unsaved work when its tab is the one closing.
   * @param tabId The closing tab's id.
   * @returns Returns the dirty document, or nothing.
   */
  public dirtyDocumentsFor(tabId: string): readonly UnsavedDocument[] {
    return tabId === this.tabId() ? this.dirtyDocuments() : [];
  }

  /**
   * Saves the document on behalf of the close flows.
   * @param id The document id, which is the tab's id.
   * @returns Returns a promise resolving true when it was saved.
   */
  public save(id: string): Promise<boolean> {
    return id === this.tabId() ? this.workspace.save() : Promise.resolve(true);
  }

  /**
   * Releases a document; the workspace dies with the view, so there is nothing to do.
   */
  public release(): void {
    // Intentionally empty: this source's document is the view's own.
  }

  /**
   * Runs the open query as its panel would, selection and all.
   */
  public execute(): void {
    const id: string | null = this.openQueryId();
    if (id !== null) {
      this.opener.run(id);
    }
  }

  /**
   * Opens a new query against the connection of the query showing, or the first connection.
   */
  public newQuery(): void {
    const id: string | null = this.openQueryId();
    const current: DatabaseQuery | undefined = id === null ? undefined : this.workspace.query(id);
    const connectionId: string | null =
      current?.connectionId ?? this.workspace.connections()[0]?.id ?? null;
    this.opener.open(this.workspace.addQuery(connectionId, current?.database).id);
  }

  /**
   * Opens the new-connection dialog.
   */
  public newConnection(): void {
    this.prompts.newConnection();
  }

  /**
   * Saves the document.
   */
  public saveDocument(): void {
    void this.workspace.save();
  }

  /**
   * Saves the document to a newly chosen file.
   */
  public saveDocumentAs(): void {
    void this.workspace.saveAs();
  }

  /**
   * Connects the target connection when it is closed — asking for its password first when it needs
   * one — and disconnects it when it is open.
   */
  public toggleConnection(): void {
    const target: ConnectionTarget | null = this.connectionTarget();
    if (target?.state === 'open') {
      void this.workspace.disconnect(target.id);
    } else if (target?.state === 'closed') {
      this.prompts.connect(target.id);
    }
  }

  /**
   * Re-reads the target connection's tree.
   */
  public refreshConnection(): void {
    const target: ConnectionTarget | null = this.connectionTarget();
    if (target?.state === 'open') {
      void this.workspace.refresh(target.id, null);
    }
  }

  /**
   * Opens the target connection's edit dialog.
   */
  public editConnection(): void {
    const target: ConnectionTarget | null = this.connectionTarget();
    if (target !== null) {
      this.prompts.editConnection(target.id);
    }
  }

  /**
   * Shows a hidden tool panel beside the panel it usually shares a group with, or on its usual edge;
   * closes one that is showing, wherever it lives. A popped-out panel is brought forward rather than
   * closed, since its own window is what closes it.
   * @param id The panel's id.
   */
  public togglePanel(id: string): void {
    if (this.popoutPanels.isPopped(id)) {
      this.dockReveal.reveal(id);
      return;
    }
    if (this.dockFloating.floats().some((float: FloatWindow): boolean => float.panelId === id)) {
      void this.dockFloating.requestClose(id);
      return;
    }
    const layout: DockNode = this.dockState.layout();
    if (collectPanelIds(layout).includes(id)) {
      void this.dockState.requestClose(id);
      return;
    }
    const home: PanelHome = PANEL_HOMES[id] ?? { beside: [], edge: 'right' };
    const anchor: StackNode | null =
      home.beside
        .map((neighbour: string): StackNode | null => findStackOfPanel(layout, neighbour))
        .find((stack: StackNode | null): stack is StackNode => stack !== null) ?? null;
    if (anchor === null) {
      this.dockState.dockEdge(id, home.edge);
    } else {
      this.dockState.tabInto(anchor.id, id);
    }
    this.dockReveal.reveal(id);
    this.log.debug('database.view', 'Panel shown from the ribbon', id);
  }

  /**
   * Asks for a passphrase to give the document, or a new one for it.
   */
  public setPassphrase(): void {
    this.prompts.askNewPassphrase();
  }

  /**
   * Removes the document's passphrase.
   */
  public removePassphrase(): void {
    this.workspace.removePassphrase();
  }

  /**
   * Asks for the passphrase of a document that is still locked.
   */
  public unlockPassphrase(): void {
    this.prompts.askUnlock();
  }

  /**
   * Restores the blueprint's arrangement — the Object Explorer, the well, and Properties tabbed with
   * the agent — carrying every open query into the new well, so a reset rearranges and closes nothing.
   * Popped-out panels come home first, so they are part of what is reset.
   */
  public resetLayout(): void {
    this.panelPopout.returnAll();
    const layout: DockNode = this.dockState.layout();
    const queries: readonly string[] = documentPanelIds(layout);
    this.log.info('database.view', 'Layout reset', queries.length);
    this.dockState.reset(queries, findDocumentWell(layout)?.active ?? queries[0] ?? null);
  }

  /**
   * Applies the connection dialog; a new connection is connected straight away.
   */
  protected async confirmConnection(): Promise<void> {
    const mode: string | null = this.prompts.mode();
    const id: string | null = await this.prompts.confirm();
    if (id !== null && mode === 'new') {
      void this.workspace.connect(id);
    }
  }

  /**
   * Fills a file field from the open dialog.
   * @param field The field.
   */
  protected async browse(field: ConnectionField): Promise<void> {
    const path: string | null = await this.fileSystem.pickPath('file');
    if (path !== null) {
      this.prompts.setValue(field.id, path);
    }
  }

  /**
   * Gets a choice field's options for the dropdown.
   * @param field The field.
   * @returns Returns the options.
   */
  protected choiceOptions(field: ConnectionField): readonly DropdownOption[] {
    return (field.options ?? []).map((option) => ({ value: option.value, label: option.label }));
  }
}

/**
 * Lists the panels in a layout's document stacks — the open queries — in tab order.
 * @param node The layout, or part of it.
 * @returns Returns the panel ids.
 */
function documentPanelIds(node: DockNode): readonly string[] {
  if (isStackNode(node)) {
    return node.role === 'document' ? node.panels : [];
  }
  return node.children.flatMap((child: DockNode): readonly string[] => documentPanelIds(child));
}

/**
 * Where a hidden tool panel goes back to: the group of the first of its usual neighbours still
 * showing, else an edge of its own.
 */
interface PanelHome {
  readonly beside: readonly string[];
  readonly edge: DockSide;
}

/**
 * Each tool panel's home, matching the blueprint: the Object Explorer on the left, Properties and the
 * agent together on the right, and the terminal under the well.
 */
const PANEL_HOMES: Readonly<Record<string, PanelHome>> = {
  objects: { beside: [], edge: 'left' },
  properties: { beside: ['agent'], edge: 'right' },
  agent: { beside: ['properties'], edge: 'right' },
  terminal: { beside: [], edge: 'bottom' },
};
