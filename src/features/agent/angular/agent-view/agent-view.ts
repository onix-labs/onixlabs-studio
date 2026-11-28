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
  Provider,
  Signal,
  untracked,
} from '@angular/core';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DockTemplatePanel } from '@shared/angular/components/dock-layout/dock-template-panel/dock-template-panel';
import { dockProviders } from '@shared/angular/services/dock-layout/dock-providers';
import {
  createDockTabRegistrar,
  DockTabRegistrar,
} from '@shared/angular/services/dock-layout/dock-tab-registration';
import { linkDockPanel } from '@shared/angular/services/dock-layout/link-dock-panel';
import {
  AGENT_CHAT_PANEL_ID,
  AGENT_DOCK_BLUEPRINT,
  AGENT_HISTORY_PANEL_ID,
} from '@features/agent/angular/agent-dock-blueprint';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentConversationList } from '@shared/angular/components/agent-conversation-list/agent-conversation-list';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { WorkspaceAgentStart, Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { Icon } from '@shared/angular/icons/icon';
import { DockSides } from '@shared/angular/services/dock-layout/dock-sides';
import { WorkspaceProposals } from '@shared/angular/services/workspace-proposals/workspace-proposals';
import {
  provideTabScoped,
  TabScopedProviders,
} from '@shared/angular/services/tab-scopes/tab-scopes';

/**
 * An agent tab's conversation and the workspace its agent offers, which a move to another window keeps. (#1587)
 */
export const AGENT_TAB_SCOPE: TabScopedProviders = {
  tokens: [Agent, AgentConversation, WorkspaceProposals, AGENT_CONVERSATION_KIND],
  providers: (): Provider[] => [
    Agent,
    AgentConversation,
    WorkspaceProposals,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'agent' },
  ],
};

/**
 * Hosts the agent conversation as a top-level tab: the {@link AgentChat} shell in the main group
 * of a dock, with the conversation history beside it, toggled from the ribbon. It provides the per-tab
 * {@link Agent} and {@link AgentConversation}, so the chat and the history list drive one conversation,
 * and publishes that conversation to {@link AgentSessions} while the tab is active so the ribbon's
 * Session group (New Chat / Stop / History) drives it.
 */
@Component({
  selector: 'app-agent-view',
  imports: [AgentChat, AgentConversationList, DockContainer, DockTemplatePanel],
  providers: [...provideTabScoped(AGENT_TAB_SCOPE), ...dockProviders(AGENT_DOCK_BLUEPRINT)],
  templateUrl: './agent-view.html',
  styleUrl: './agent-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentView implements OnInit, OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Exposes the sides a panel may dock to to the template.
   */
  protected readonly DockSides: typeof DockSides = DockSides;

  /**
   * Gets the identifier of the conversation's panel.
   */
  protected readonly chatPanel: string = AGENT_CHAT_PANEL_ID;

  /**
   * Gets the identifier of the Conversation History panel.
   */
  protected readonly historyPanel: string = AGENT_HISTORY_PANEL_ID;

  /**
   * Holds this tab's conversation, published to the session registry while active and shared by the
   * chat and history list.
   */
  protected readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds this tab's agent, which a new project's start briefs.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the per-tab handoff a new project's agent start arrives through (#806).
   */
  private readonly workspaces: Workspaces = inject(Workspaces);

  /**
   * Holds this tab's workspace proposals, told which tab closes once one is made (#876).
   */
  private readonly proposals: WorkspaceProposals = inject(WorkspaceProposals);

  /**
   * Holds the active agent session registry the ribbon and accelerators drive.
   */
  private readonly sessions: AgentSessions = inject(AgentSessions);

  /**
   * Holds the application keybinding router this view registers its accelerators with while active.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds a value indicating whether this view's accelerators are currently registered, so activation
   * changes register and release them exactly once.
   */
  private registered: boolean = false;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds whether this view's tab is the one the user is working in.
   */
  private readonly currentTab: Signal<boolean> = inject(Tabs).isCurrent((): string | undefined =>
    this.tabId(),
  );

  /**
   * Gets whether this is showing in the tab the user is working in — the active tab of the window in
   * front — which is when it may claim what the app has one of: the ribbon's commands, the shortcuts,
   * the active document (#1587). Showing alone ({@link isActive}) is enough for what only draws.
   */
  protected readonly isCurrent: Signal<boolean> = computed(
    (): boolean => this.isActive() && this.currentTab(),
  );

  /**
   * Publishes this view's injector while it is active, so the status strip mounts the tab's status
   * (#882) inside it and reads this tab's own {@link Agent}. Finalised in {@link ngOnInit} once the tab
   * id is readable.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Registers this tab's dock. Finalised in {@link ngOnInit} once the tab id is readable.
   */
  private readonly dockTab: DockTabRegistrar = createDockTabRegistrar();

  /**
   * Initializes a new instance of the {@link AgentView} class, publishing this tab's conversation to
   * the session registry while active (so the ribbon drives it) and registering/releasing the keyboard
   * accelerators as the view's active state changes.
   */
  public constructor() {
    // The conversation says whether its history is open: the ribbon toggles it there, and choosing a
    // conversation closes it.
    linkDockPanel(
      AGENT_HISTORY_PANEL_ID,
      (): boolean => this.conversation.historyOpen(),
      (): void => this.conversation.toggleHistory(),
    );

    effect((): void => {
      const active: boolean = this.isCurrent();
      untracked((): void => {
        if (active) {
          this.sessions.setActive(this.conversation);
        } else {
          this.sessions.clearActive(this.conversation);
        }
      });
    });

    effect((): void => {
      const id: string | undefined = this.tabId();
      if (id === undefined) {
        return;
      }
      if (this.isCurrent()) {
        if (!this.registered) {
          this.registerKeybindings(id);
          this.registered = true;
        }
      } else if (this.registered) {
        this.keybindings.deactivate(id);
        this.registered = false;
      }
    });
  }

  /**
   * Starts the conversation on a new project when the welcome screen opened this tab for one: fresh,
   * briefed on the project's starter, sending the user's first message at once (#806) — on the project
   * surface, as this tab's chat sends.
   */
  public ngOnInit(): void {
    const id: string | undefined = this.tabId();
    if (id !== undefined) {
      this.dockTab.register(id);
      this.statusHost.register(id);
      this.proposals.bind(id);
    }
    const start: WorkspaceAgentStart | undefined =
      id === undefined ? undefined : this.workspaces.takeAgentStart(id);
    if (start !== undefined) {
      this.log.info('agent.view', 'Starting the agent on a new project', { tabId: id });
      this.conversation.newChat();
      this.agent.setBrief(start.brief);
      for (const reference of start.context ?? []) {
        this.agent.attachContext(reference);
      }
      if (start.send === false) {
        this.conversation.draft.set(start.prompt);
      } else {
        void this.agent.sendWhenReady(start.prompt, id, 'project', start.images ?? []);
      }
    }
  }

  /**
   * Releases the keyboard accelerators when the view is torn down.
   */
  public ngOnDestroy(): void {
    const id: string | undefined = this.tabId();
    if (id !== undefined) {
      this.log.debug('agent.view', 'Agent view destroyed; releasing accelerators', { tabId: id });
      this.keybindings.forget(id);
    }
  }

  /**
   * Registers the agent tab's keyboard accelerators: Mod+. stops the in-flight run (the cancel
   * convention) and Mod+Shift+N starts a fresh conversation. Both are non-typing chords, so they do
   * not interfere with the message composer.
   * @param id The owning tab identifier.
   */
  private registerKeybindings(id: string): void {
    this.log.debug('agent.view', 'Registering agent accelerators', { tabId: id });
    this.keybindings.register(id, [
      {
        id: 'agent.stop',
        command: (): void => {
          this.log.info('agent.view', 'Stop run requested via accelerator', { tabId: id });
          this.sessions.stop();
        },
      },
      {
        id: 'agent.newChat',
        command: (): void => {
          this.log.info('agent.view', 'New chat requested via accelerator', { tabId: id });
          this.sessions.newChat();
        },
      },
    ]);
  }
}
