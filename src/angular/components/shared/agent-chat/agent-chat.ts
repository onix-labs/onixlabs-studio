import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AiModelInfo, AiProviderId, AiProviderInfo } from '../../../../shared/ai-types';
import { Agent, AgentItem } from '../../../services/agent/agent';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../icon/app-icon';
import { MarkdownPipe } from './markdown-pipe';

/**
 * Renders the agent conversation as a structured, provider-agnostic transcript above a composer:
 * user/assistant turns (assistant text rendered as markdown), dim reasoning, tool-activity chips, and
 * inline permission prompts. State lives in the {@link Agent} service, so the agent tab and the
 * dockable agent panel show the same conversation. Sending streams a live response; Stop aborts it.
 * Links in agent output open in the OS browser rather than navigating the app.
 */
@Component({
  selector: 'app-agent-chat',
  imports: [AppIcon, MarkdownPipe],
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
   * Holds the agent conversation service.
   */
  private readonly agent: Agent = inject(Agent);

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
   * Gets the registered providers and their availability.
   */
  public readonly providers: Signal<readonly AiProviderInfo[]> = this.agent.providers;

  /**
   * Gets the selected provider.
   */
  public readonly provider: Signal<AiProviderId> = this.agent.provider;

  /**
   * Gets the models offered by the selected provider.
   */
  public readonly models: Signal<readonly AiModelInfo[]> = this.agent.models;

  /**
   * Gets the selected model identifier.
   */
  public readonly model: Signal<string> = this.agent.model;

  /**
   * Gets a value indicating whether the agent is waiting on a permission decision.
   */
  public readonly awaitingDecision: Signal<boolean> = this.agent.awaitingDecision;

  /**
   * Gets the current composer text.
   */
  public readonly draft: Signal<string> = this.draftText.asReadonly();

  /**
   * Records composer input.
   * @param value The new composer text.
   */
  public onInput(value: string): void {
    this.draftText.set(value);
  }

  /**
   * Selects the provider runs go through.
   * @param id The provider id.
   */
  public onProviderChange(id: string): void {
    this.agent.setProvider(id as AiProviderId);
  }

  /**
   * Selects the model runs go through.
   * @param id The model id.
   */
  public onModelChange(id: string): void {
    this.agent.setModel(id);
  }

  /**
   * Sends the current draft to the agent and clears the composer. Blank drafts are ignored.
   */
  public send(): void {
    const text: string = this.draftText();
    if (text.trim().length === 0) {
      return;
    }
    this.agent.send(text);
    this.draftText.set('');
  }

  /**
   * Stops the in-flight run.
   */
  public stop(): void {
    this.agent.stop();
  }

  /**
   * Clears the transcript.
   */
  public clear(): void {
    this.agent.clear();
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
