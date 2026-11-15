import { LogRecord } from '@shared/api/log-channels';

/**
 * Describes the logs at a glance, for the Overview's Logs card: the current session's counts by
 * severity and its latest records.
 */
export interface LogsOverview {
  /**
   * Gets the number of informational records.
   */
  readonly info: number;

  /**
   * Gets the number of warnings.
   */
  readonly warnings: number;

  /**
   * Gets the number of errors.
   */
  readonly errors: number;

  /**
   * Gets the latest records, newest first.
   */
  readonly recent: readonly LogRecord[];
}
