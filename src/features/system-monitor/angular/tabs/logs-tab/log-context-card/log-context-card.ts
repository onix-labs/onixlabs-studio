import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { CodeBlock } from '@shared/angular/components/code-block/code-block';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { LogRecord } from '@shared/api/log-channels';
import { LogCode, logContext, logRaw } from './log-context';

/**
 * Identifies what the card shows: the record's context, or the record as stored.
 */
type ContextTab = 'context' | 'raw';

/**
 * Represents the Logs view's context card: what was logged with the chosen record's message (an
 * object as JSON, an error's stack), or the record itself as it is stored, either copied with a click.
 */
@Component({
  selector: 'app-system-monitor-log-context-card',
  imports: [Button, CodeBlock],
  templateUrl: './log-context-card.html',
  styleUrl: './log-context-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogContextCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the record chosen, or null when none is.
   */
  public readonly record: InputSignal<LogRecord | null> = input<LogRecord | null>(null);

  /**
   * Holds what the card shows: the context, or the raw record.
   */
  protected readonly tab: WritableSignal<ContextTab> = signal<ContextTab>('context');

  /**
   * Holds whether the shown text was just copied, for the button's tick.
   */
  protected readonly copied: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the text the tab shows, or null when there is none (no record, or no context logged).
   */
  protected readonly code: Signal<LogCode | null> = computed((): LogCode | null => {
    const record: LogRecord | null = this.record();
    if (record === null) {
      return null;
    }
    return this.tab() === 'raw' ? logRaw(record) : logContext(record);
  });

  /**
   * Gets what the card says when it has nothing to show.
   */
  protected readonly emptyText: Signal<string> = computed((): string =>
    this.record() === null
      ? 'Choose a record to see its context.'
      : 'Nothing was logged with this message.',
  );

  /**
   * Shows the context or the raw record.
   * @param tab What to show.
   */
  protected setTab(tab: ContextTab): void {
    this.tab.set(tab);
    this.copied.set(false);
  }

  /**
   * Copies the shown text. A no-op where the clipboard is unavailable.
   * @returns Returns a promise that resolves once the copy settles.
   */
  protected async copy(): Promise<void> {
    const code: LogCode | null = this.code();
    if (code === null) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(code.text);
      this.copied.set(true);
    } catch {
      // A denied or unavailable clipboard is deliberately swallowed.
    }
  }
}
