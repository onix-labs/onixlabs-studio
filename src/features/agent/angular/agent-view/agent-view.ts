import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentConversationList } from '@shared/angular/components/agent-conversation-list/agent-conversation-list';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
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
  providers: [Agent, AgentConversation],
  templateUrl: './agent-view.html',
  styleUrl: './agent-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentView implements OnDestroy {
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
   * Holds the width, in pixels, of the docked conversation-history panel. Two-way bound to the panel's
   * splitter.
   */
  protected readonly historySize: WritableSignal<number> = signal<number>(300);

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
   * Releases the keyboard accelerators when the view is torn down.
   */
  public ngOnDestroy(): void {
    const id: string | undefined = this.tabId();
    if (id !== undefined) {
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
    this.keybindings.register(id, [
      { chord: 'Mod+.', command: (): void => this.sessions.stop() },
      { chord: 'Mod+Shift+N', command: (): void => this.sessions.newChat() },
    ]);
  }
}
