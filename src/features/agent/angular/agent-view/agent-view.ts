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
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentConversationList } from '@shared/angular/components/agent-conversation-list/agent-conversation-list';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Hosts the agent conversation as a top-level tab: the {@link AgentChat} shell in the centre with the
 * conversation history docked as a side panel toggled from the ribbon. It provides the per-tab
 * {@link Agent} and {@link AgentConversation}, so the chat and the history list drive one conversation,
 * and publishes that conversation to {@link AgentSessions} while the tab is active so the ribbon's
 * Session group (New Chat / Stop / History) drives it.
 */
@Component({
  selector: 'app-agent-view',
  imports: [PanelLayout, Panel, AgentChat, AgentConversationList, ToolPanel],
  providers: [Agent, AgentConversation, { provide: AGENT_CONVERSATION_KIND, useValue: 'agent' }],
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
   * Holds this tab's conversation, published to the session registry while active and shared by the
   * chat and history list.
   */
  protected readonly conversation: AgentConversation = inject(AgentConversation);

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
   * Publishes this view's injector so the shell's status strip can mount the agent status component
   * inside it, where it reaches this tab's own {@link Agent}. Declared after {@link isActive}, whose
   * signal it reads, and finalised in {@link ngOnInit} once the tab id is readable.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Initializes a new instance of the {@link AgentView} class, publishing this tab's conversation to
   * the session registry while active (so the ribbon drives it) and registering/releasing the keyboard
   * accelerators as the view's active state changes.
   */
  public constructor() {
    effect((): void => {
      const active: boolean = this.isActive();
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
      if (this.isActive()) {
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
   * Publishes this view's injector for the status strip, once the tab id is readable. A docked agent
   * panel has no tab of its own, so there is nothing to publish against and the strip shows the
   * hosting view's status instead.
   */
  public ngOnInit(): void {
    const id: string | undefined = this.tabId();
    if (id !== undefined) {
      this.statusHost.register(id);
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
