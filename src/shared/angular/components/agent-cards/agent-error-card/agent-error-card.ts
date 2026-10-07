import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { AgentCard } from '../agent-card/agent-card';

/**
 * A failed run (#855): the cause over the provider it went through, expandable diagnostics, and a
 * one-click retry of the failed turn.
 */
@Component({
  selector: 'app-agent-error-card',
  imports: [AgentCard, AppIcon, Button],
  templateUrl: './agent-error-card.html',
  styleUrl: './agent-error-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentErrorCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the error item.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();

  /**
   * Gets whether a turn is running, which holds the retry back.
   */
  public readonly busy: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the user retries the failed turn.
   */
  public readonly retry: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the expandable diagnostics: the raw provider error, plus the failing tool's context when a
   * tool failure preceded the run's end. Empty when the cause line carries everything.
   */
  protected readonly diagnostics: Signal<string> = computed((): string => {
    const item: AgentItem = this.item();
    const parts: string[] = [];
    if (item.errorDetail !== undefined) {
      parts.push(item.errorDetail);
    }
    if (item.errorToolContext !== undefined) {
      parts.push(`Failed tool — ${item.errorToolContext}`);
    }
    return parts.join('\n\n');
  });
}
