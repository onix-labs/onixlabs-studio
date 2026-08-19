import { effect, inject, Service } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { ApiEnvironment, ApiHistoryEntry } from '@shared/api/api-client-types';
import { ApiWorkspace } from '../api-workspace/api-workspace';

/**
 * The status-strip segment ids and the owner/priority this feature contributes under.
 */
const ENVIRONMENT_SEGMENT_ID: string = 'api-explorer-environment';
const LAST_SEND_SEGMENT_ID: string = 'api-explorer-last-send';
const STATUS_OWNER: string = 'api-explorer';
const STATUS_PRIORITY: number = 15;

/**
 * Contributes the API Explorer's two pieces of always-relevant state to the shared status strip: which
 * environment is resolving variables, and how the last send went.
 *
 * The environment belongs here rather than only in the tree because it silently changes what every
 * request does — sending a staging request at production is the mistake this segment exists to
 * prevent. The last-send result belongs here because the response pane is only visible on the tab that
 * produced it.
 */
@Service()
export class ApiExplorerStatus {
  /**
   * Holds the shared status strip.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the API workspace the segments are derived from.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Publishes the segments and keeps them in step with the workspace.
   */
  public constructor() {
    effect((): void => {
      const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
      const last: ApiHistoryEntry | undefined = this.workspace.history()[0];
      this.statusBar.contribute(
        STATUS_OWNER,
        {
          leading: [],
          trailing: [
            {
              id: ENVIRONMENT_SEGMENT_ID,
              text: environment?.name ?? 'No environment',
              icon: Icon.API_ENVIRONMENT,
              title: 'The environment requests resolve their variables against',
            },
            ...(last === undefined
              ? []
              : [
                  {
                    id: LAST_SEND_SEGMENT_ID,
                    text: this.describe(last),
                    icon: Icon.API_REQUEST,
                    title: `${last.method} ${last.url}`,
                  },
                ]),
          ],
        },
        STATUS_PRIORITY,
      );
    });
  }

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
