import {
  ChangeDetectionStrategy,
  Component,
  effect,
  HostListener,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type { AgentSurface } from '../../../../shared/ai-types';
import { Agent, AgentItem } from '@shared/angular/services/agent/agent';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MarkdownPipe } from './markdown-pipe';

/**
 * Renders one agent conversation as a structured, provider-agnostic transcript above a composer:
 * user/assistant turns (assistant text rendered as markdown), dim reasoning, tool-activity chips, and
 * inline permission prompts. The conversation lives in a per-instance {@link Agent} session provided
 * here, so every agent tab and the dockable agent panel each own an independent transcript. Sending
 * streams a live response; Stop aborts it. The provider/model selection lives in the agent ribbon's
 * Engine group, not the composer. Links in agent output open in the OS browser rather than navigating
 * the app.
 */
@Component({
  selector: 'app-agent-chat',
  imports: [AppIcon, MarkdownPipe],
  providers: [Agent],
  templateUrl: './agent-chat.html',
  styleUrl: './agent-chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentChat {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds this conversation's agent session.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the registry the active agent tab's session is published to for the ribbon to drive.
   */
  private readonly sessions: AgentSessions = inject(AgentSessions);

  /**
   * Holds the tab registry, used to light this conversation's tab while it awaits a decision.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Gets the identifier of the tab hosting this conversation, or undefined when not hosted by a tab
   * (e.g. the dockable agent panel).
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the hosting tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets what this conversation's runs act on, which selects the tool set the providers expose: the
   * open editor document (`editor`, the default) or the owning terminal (`terminal`).
   */
  public readonly surface: InputSignal<AgentSurface> = input<AgentSurface>('editor');

  /**
   * Holds the current composer text.
   */
  private readonly draftText: WritableSignal<string> = signal<string>('');

  /**
   * Gets the transcript rendered in the message list.
   */
  public readonly items: Signal<readonly AgentItem[]> = this.agent.items;

  /**
   * Gets a value indicating whether a run is in flight.
   */
  public readonly isRunning: Signal<boolean> = this.agent.isRunning;

  /**
   * Gets a value indicating whether the agent is waiting on a permission decision.
   */
  public readonly awaitingDecision: Signal<boolean> = this.agent.awaitingDecision;

  /**
   * Gets the current composer text.
   */
  public readonly draft: Signal<string> = this.draftText.asReadonly();

  /**
   * Initializes a new instance of the {@link AgentChat} class, publishing this conversation as the
   * ribbon's target while its tab is active and lighting the tab's attention dot while it awaits a
   * decision in the background.
   */
  public constructor() {
    effect((): void => {
      const active: boolean = this.isActive();
      untracked((): void => {
        if (active) {
          this.sessions.setActive(this.agent);
        } else {
          this.sessions.clearActive(this.agent);
        }
      });
    });

    effect((): void => {
      const id: string | undefined = this.tabId();
      const waiting: boolean = this.awaitingDecision();
      const active: boolean = this.isActive();
      untracked((): void => {
        if (id !== undefined) {
          this.tabs.setAttention(id, waiting && !active);
        }
      });
    });
  }

  /**
   * Records composer input.
   * @param value The new composer text.
   */
  public onInput(value: string): void {
    this.draftText.set(value);
  }

  /**
   * Sends the current draft to the agent and clears the composer. Blank drafts are ignored.
   */
  public send(): void {
    const text: string = this.draftText();
    if (text.trim().length === 0) {
      return;
    }
    this.agent.send(text, this.tabId(), this.surface());
    this.draftText.set('');
  }

  /**
   * Stops the in-flight run.
   */
  public stop(): void {
    this.agent.stop();
  }

  /**
   * Answers a pending permission prompt.
   * @param item The permission item.
   * @param granted Whether the user granted permission.
   */
  public respond(item: AgentItem, granted: boolean): void {
    this.agent.respondPermission(item, granted);
  }

  /**
   * Handles composer key presses: sends on Enter, but leaves Shift+Enter to insert a newline.
   * @param event The keyboard event.
   */
  public onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.send();
  }

  /**
   * Opens links in agent output in the OS browser instead of navigating the app window.
   * @param event The click event.
   */
  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    const anchor: HTMLAnchorElement | null =
      event.target instanceof Element ? event.target.closest('a') : null;
    const href: string | undefined = anchor?.href;
    if (href === undefined || href.length === 0) {
      return;
    }
    event.preventDefault();
    void window.studio?.shell?.openExternal(href);
  }
}
