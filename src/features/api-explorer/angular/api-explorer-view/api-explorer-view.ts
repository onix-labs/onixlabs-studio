import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  Signal,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AGENT_CONVERSATION_CONTEXT,
  AGENT_CONVERSATION_KIND,
  ConversationContextResolver,
  GLOBAL_CONVERSATION_CONTEXT,
} from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { PanelPopout } from '@shared/angular/services/panel-popout/panel-popout';
import { TerminalSessions } from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Log } from '@shared/angular/services/log/log';
import { ApiEnvironment, ApiFolder, ApiRequest } from '@shared/api/api-client-types';
import { API_EXPLORER_DOCK_BLUEPRINT } from '../api-explorer-dock-blueprint';
import {
  ApiExplorerCommandHandler,
  ApiExplorerCommands,
} from '../api-explorer-commands/api-explorer-commands';
import { ApiExplorerStatus } from '../api-explorer-status/api-explorer-status';
import { ApiHttp } from '../api-http/api-http';
import { ApiRequestOpener } from '../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../api-workspace/api-workspace';

/**
 * The API Explorer tab: a dock surface for building, sending and reasoning about HTTP APIs.
 *
 * It is the first *tool* view to host the dock framework rather than laying out its own body, and it
 * does so for the reason the workspace does — the arrangement is the user's, not the feature's. The
 * view itself is therefore almost empty: it provides the dock services, the blueprint that names its
 * panels, the API workspace those panels share, and an agent conversation scoped to this tab. The
 * template is a single dock container.
 *
 * The services are provided *here* rather than in the panels on purpose. A dock tool stack destroys an
 * inactive panel when a sibling activates, so state owned by a panel would be lost on a tab switch:
 * collections, history, the agent's transcript and the terminal's PTYs all live at the view's level,
 * exactly as they do in a workspace tab.
 */
@Component({
  selector: 'app-api-explorer-view',
  imports: [DockContainer],
  templateUrl: './api-explorer-view.html',
  styleUrl: './api-explorer-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    // The API document model and its transport: one per tab, shared by every panel in it.
    ApiHttp,
    ApiWorkspace,
    ApiRequestOpener,
    ApiExplorerStatus,
    // The dock framework, instantiated per dock-hosting view.
    DockTabContext,
    DockState,
    DockGeometry,
    DockFocus,
    DockPanelRegistry,
    DockFloating,
    DockAutoHide,
    DockDrag,
    DockReveal,
    TerminalSessions,
    PopoutPanels,
    PanelPopout,
    { provide: DOCK_BLUEPRINT, useValue: API_EXPLORER_DOCK_BLUEPRINT },
    // The agent conversation lives at the view's level for the same reason it does in a workspace: a
    // conversation scoped to the dock panel would lose its transcript whenever a sibling tool
    // activated.
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'workspace' },
    {
      // The API Explorer has no folder on disk to key conversations on, so its agent talks in the
      // global bucket. Keying on the collection (once collections are files on disk) is the obvious
      // next step, and is why this is a resolver rather than a constant.
      provide: AGENT_CONVERSATION_CONTEXT,
      useFactory: (): ConversationContextResolver => (): ConversationContext =>
        GLOBAL_CONVERSATION_CONTEXT,
    },
  ],
})
export class ApiExplorerView implements OnInit, OnDestroy, ApiExplorerCommandHandler {
  /**
   * Gets the owning tab's id.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the dock's layout state, read to find which request the well is showing.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the ribbon's command registry this view registers itself with while it is alive.
   */
  private readonly commands: ApiExplorerCommands = inject(ApiExplorerCommands);

  /**
   * Holds the dock's tab context, carrying this tab's identity to the panels inside it.
   */
  private readonly tabContext: DockTabContext = inject(DockTabContext);

  /**
   * Gets the identifier of the request the well is currently showing, or null when the well is empty.
   * Derived from the dock's own active-panel state rather than tracked separately, so switching tabs
   * in the well is immediately what the ribbon acts on.
   */
  private readonly openRequestId: Signal<string | null> = computed((): string | null => {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    return well?.active ?? null;
  });

  /**
   * Gets whether a request is open in the well and can therefore be sent.
   */
  public readonly canSend: Signal<boolean> = computed((): boolean => this.openRequestId() !== null);

  /**
   * Gets whether the open request is in flight.
   */
  public readonly sending: Signal<boolean> = computed((): boolean => {
    const id: string | null = this.openRequestId();
    return id !== null && this.workspace.inFlight().has(id);
  });

  /**
   * Gets the active environment's name, or null when none is active.
   */
  public readonly environmentName: Signal<string | null> = computed(
    (): string | null => this.workspace.activeEnvironment()?.name ?? null,
  );

  /**
   * Holds the API workspace, so the view can open a request on first show.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the opener that puts a request into the well.
   */
  private readonly opener: ApiRequestOpener = inject(ApiRequestOpener);

  /**
   * Holds the status-strip contribution. Injected purely to instantiate it: it publishes from its own
   * constructor and needs nothing from the view.
   */
  private readonly status: ApiExplorerStatus = inject(ApiExplorerStatus);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens the first saved request into the well, so the tab lands on something sendable rather than an
   * empty document area. A user who has closed every request tab gets the same treatment next time the
   * view opens, which matches how a workspace restores its documents.
   */
  public ngOnInit(): void {
    void this.status;
    this.commands.register(this);
    // Panels that need a globally-unique session id (the terminal) read the owning tab from here.
    this.tabContext.setTabId(this.tabId());
    const first: ApiRequest | undefined = this.workspace.requests()[0];
    if (first !== undefined) {
      this.opener.open(first.id);
    }
    this.log.info('api-explorer.view', 'API Explorer opened', {
      requests: this.workspace.requests().length,
    });
  }

  /**
   * Releases the ribbon's command registration, so the ribbon of a closed tab drives nothing.
   */
  public ngOnDestroy(): void {
    this.commands.clear(this);
  }

  /**
   * Sends the request open in the well, or cancels it when it is already in flight.
   */
  public send(): void {
    const id: string | null = this.openRequestId();
    if (id === null) {
      return;
    }
    if (this.sending()) {
      this.workspace.cancel(id);
      return;
    }
    void this.workspace.send(id);
  }

  /**
   * Adds a request to the first collection and opens it in the well.
   */
  public newRequest(): void {
    const collection: ApiFolder | undefined = this.workspace
      .folders()
      .find((folder: ApiFolder): boolean => folder.parentId === null);
    const parent: ApiFolder = collection ?? this.workspace.addCollection('My API');
    this.opener.open(this.workspace.addRequest(parent.id, { url: '{{base_url}}/' }).id);
  }

  /**
   * Adds a collection.
   */
  public newCollection(): void {
    this.workspace.addCollection('New collection');
  }

  /**
   * Switches to the next environment, wrapping at the end. With none defined this does nothing.
   */
  public cycleEnvironment(): void {
    const environments: readonly ApiEnvironment[] = this.workspace.environments();
    if (environments.length === 0) {
      return;
    }
    const current: number = environments.findIndex(
      (environment: ApiEnvironment): boolean =>
        environment.id === this.workspace.activeEnvironmentId(),
    );
    this.workspace.activateEnvironment(environments[(current + 1) % environments.length].id);
  }
}
