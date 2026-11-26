import type { NotificationTypeDef } from '@shared/angular/services/notifications/notification-types';

/**
 * Names the notification types the Tests panel raises (#1489).
 */
export enum TestNotificationType {
  /**
   * A test run finished and every test passed.
   */
  Passed = 'tests.passed',

  /**
   * A test run finished with failures, or could not run.
   */
  Failed = 'tests.failed',
}

/**
 * Lists the notification types the Tests panel raises: a run that failed pops up, so a long run can be
 * left running; one that passed goes to the history.
 */
export const TEST_NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    id: TestNotificationType.Passed,
    label: 'Test Run Passed',
    description: 'A test run finished and every test passed.',
    area: 'Tests',
    default: 'history',
  },
  {
    id: TestNotificationType.Failed,
    label: 'Test Run Failed',
    description: 'A test run finished with failures, or could not run.',
    area: 'Tests',
    default: 'popup',
  },
];
