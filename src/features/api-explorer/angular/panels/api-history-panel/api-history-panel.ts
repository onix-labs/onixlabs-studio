import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiHistoryEntry } from '@shared/api/api-client-types';
import { ApiRequestOpener } from '../../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../../api-workspace/api-workspace';

/**
 * The send history: every request this session sent, newest first, with what came back. It answers the
 * question the response pane cannot — "what did this return *last* time?" — which is most of debugging
 * an API by hand.
 *
 * History is session state, not saved state: it is deliberately not persisted with the collections,
 * because a record of what was sent is a working note rather than part of the user's document.
 */
@Component({
  selector: 'app-api-history-panel',
  imports: [Button, DatePipe],
  templateUrl: './api-history-panel.html',
  styleUrl: './api-history-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiHistoryPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the API workspace the history is read from.
   */
  protected readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the opener, so a history entry can reopen the request it came from.
   */
  private readonly opener: ApiRequestOpener = inject(ApiRequestOpener);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Re-opens the saved request a history entry came from. An entry whose request has since been
   * deleted opens nothing.
   * @param entry The history entry.
   */
  protected reopen(entry: ApiHistoryEntry): void {
    if (entry.requestId !== null) {
      this.opener.open(entry.requestId);
    }
  }

  /**
   * Summarises an entry's outcome for the row: a status code, or why there wasn't one.
   * @param entry The history entry.
   * @returns Returns the text shown as the entry's result.
   */
  protected result(entry: ApiHistoryEntry): string {
    if (entry.outcome.kind === 'response') {
      return String(entry.outcome.status);
    }
    return entry.outcome.cancelled ? 'cancelled' : 'failed';
  }

  /**
   * Classifies an entry's outcome, so the row can colour its result.
   * @param entry The history entry.
   * @returns Returns the tone of the entry's result.
   */
  protected tone(entry: ApiHistoryEntry): string {
    if (entry.outcome.kind === 'failure') {
      return entry.outcome.cancelled ? 'muted' : 'error';
    }
    if (entry.outcome.status < 300) {
      return 'ok';
    }
    return entry.outcome.status < 400 ? 'redirect' : 'error';
  }

  /**
   * Gets how long an entry's send took, in milliseconds.
   * @param entry The history entry.
   * @returns Returns the duration in milliseconds.
   */
  protected duration(entry: ApiHistoryEntry): number {
    return entry.outcome.kind === 'response'
      ? Math.round(entry.outcome.timings.totalMs)
      : Math.round(entry.outcome.durationMs);
  }
}
