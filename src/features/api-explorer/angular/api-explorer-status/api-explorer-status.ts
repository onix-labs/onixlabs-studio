import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { ApiEnvironment, ApiHistoryEntry } from '@shared/api/api-client-types';
import { ApiWorkspace } from '../api-workspace/api-workspace';

/**
 * Shows the active API Explorer view's two pieces of always-relevant state at the end of the status
 * strip: which environment is resolving variables, and how the last send went.
 *
 * The environment belongs here rather than only in the tree because it silently changes what every
 * request does — sending a staging request at production is the mistake this segment exists to
 * prevent. The last-send result belongs here because the response pane is only visible on the tab that
 * produced it.
 *
 * Mounted by the status strip through the active API Explorer view's injector, so it reads that tab's
 * own {@link ApiWorkspace}; it is destroyed when another tab is activated, so one tab's environment
 * can never be read as another's — nor linger over a tab that has no API workspace at all.
 */
@Component({
  selector: 'app-api-explorer-status',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiExplorerStatus {
  /**
   * Holds the API workspace the segments are derived from.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Gets the end-aligned segments: the active environment, and the last send's outcome.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
      const last: ApiHistoryEntry | undefined = this.workspace.history()[0];
      return [
        {
          id: 'api-explorer-environment',
          text: environment?.name ?? 'No environment',
          icon: Icon.API_ENVIRONMENT,
          title: 'The environment requests resolve their variables against',
        },
        ...(last === undefined
          ? []
          : [
              {
                id: 'api-explorer-last-send',
                text: this.describe(last),
                icon: Icon.API_REQUEST,
                title: `${last.method} ${last.url}`,
              },
            ]),
      ];
    },
  );

  /**
   * Summarises a send for the strip: its status and how long it took, or why there was no status.
   * @param entry The history entry to describe.
   * @returns Returns the segment text.
   */
  private describe(entry: ApiHistoryEntry): string {
    if (entry.outcome.kind === 'failure') {
      return entry.outcome.cancelled ? 'cancelled' : 'failed';
    }
    return `${entry.outcome.status} · ${Math.round(entry.outcome.timings.totalMs)} ms`;
  }
}
