import type { NotificationTypeDef } from './notification-types';

/**
 * Names the notification types the shared services raise: the agent and the build runner.
 */
export enum CoreNotificationType {
  /**
   * An agent finished its turn or a background task.
   */
  AgentFinished = 'agent.finished',

  /**
   * An agent stopped on an error, or a background task failed.
   */
  AgentFailed = 'agent.failed',

  /**
   * A run ended on its own with exit code 0.
   */
  RunFinished = 'run.finished',

  /**
   * A run ended on its own with a non-zero exit code.
   */
  RunFailed = 'run.failed',

  /**
   * A build finished without errors.
   */
  BuildFinished = 'build.finished',

  /**
   * A build finished with errors.
   */
  BuildFailed = 'build.failed',
}

/**
 * Lists the notification types the shared services raise. Their defaults pop up, success included,
 * because they did before types existed (#1486): an upgrade must not quieten what a user relied on.
 */
export const CORE_NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    id: CoreNotificationType.AgentFinished,
    label: 'Agent Finished',
    description: 'An agent finished its turn or a background task.',
    area: 'Agents',
    default: 'popup',
  },
  {
    id: CoreNotificationType.AgentFailed,
    label: 'Agent Failed',
    description: 'An agent stopped on an error, or a background task failed.',
    area: 'Agents',
    default: 'popup',
  },
  {
    id: CoreNotificationType.RunFinished,
    label: 'Run Finished',
    description: 'A run ended on its own with exit code 0.',
    area: 'Runs and Builds',
    default: 'popup',
  },
  {
    id: CoreNotificationType.RunFailed,
    label: 'Run Failed',
    description: 'A run ended on its own with a non-zero exit code.',
    area: 'Runs and Builds',
    default: 'popup',
  },
  {
    id: CoreNotificationType.BuildFinished,
    label: 'Build Succeeded',
    description: 'A build finished without errors.',
    area: 'Runs and Builds',
    default: 'popup',
  },
  {
    id: CoreNotificationType.BuildFailed,
    label: 'Build Failed',
    description: 'A build finished with errors.',
    area: 'Runs and Builds',
    default: 'popup',
  },
];
