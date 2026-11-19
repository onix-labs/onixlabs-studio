import type { NotificationTypeDef } from './notification-types';

/**
 * Names the notification types the shared services raise: the agent, the build runner and cloning.
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

  /**
   * A repository finished cloning.
   */
  CloneFinished = 'clone.finished',

  /**
   * A repository could not be cloned.
   */
  CloneFailed = 'clone.failed',

  /**
   * A run or task terminal's command ended with exit code 0 while the user was elsewhere.
   */
  TerminalFinished = 'terminal.finished',

  /**
   * A run or task terminal's command ended with a non-zero exit code while the user was elsewhere.
   */
  TerminalFailed = 'terminal.failed',

  /**
   * A background fetch found commits on the current branch's upstream that the branch lacks.
   */
  GitIncoming = 'git.incoming',

  /**
   * A background fetch found the current branch and its upstream have diverged.
   */
  GitDiverged = 'git.diverged',

  /**
   * A CI run for a branch pushed from Studio passed.
   */
  CiPassed = 'ci.passed',

  /**
   * A CI run for a branch pushed from Studio failed.
   */
  CiFailed = 'ci.failed',

  /**
   * Pete has changes to the persona waiting for the user's review (#1517).
   */
  PersonaReview = 'persona.review',
}

/**
 * Lists the notification types the shared services raise. The agent, run and build ones pop up,
 * success included, because they did before types existed (#1486): an upgrade must not quieten what a
 * user relied on. A finished clone pops up too (#1493): the user is waiting on it to open. A run or
 * task terminal's command that ended while the user was elsewhere pops up only when it failed (#1496).
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
  {
    id: CoreNotificationType.CloneFinished,
    label: 'Clone Finished',
    description: 'A repository finished cloning.',
    area: 'Cloning',
    default: 'popup',
  },
  {
    id: CoreNotificationType.CloneFailed,
    label: 'Clone Failed',
    description: 'A repository could not be cloned.',
    area: 'Cloning',
    default: 'popup',
  },
  {
    id: CoreNotificationType.TerminalFinished,
    label: 'Terminal Command Finished',
    description:
      "A run or task terminal's command ended with exit code 0 while you were elsewhere.",
    area: 'Terminals',
    default: 'history',
  },
  {
    id: CoreNotificationType.TerminalFailed,
    label: 'Terminal Command Failed',
    description: "A run or task terminal's command failed while you were elsewhere.",
    area: 'Terminals',
    default: 'popup',
  },
  {
    id: CoreNotificationType.GitIncoming,
    label: 'New Commits on the Remote',
    description:
      "A background fetch found commits on your branch's remote copy that you don't have yet.",
    area: 'Source Control',
    default: 'history',
  },
  {
    id: CoreNotificationType.GitDiverged,
    label: 'Branch Diverged',
    description:
      'A background fetch found your branch and its remote copy each have commits the other lacks.',
    area: 'Source Control',
    default: 'popup',
  },
  {
    id: CoreNotificationType.CiPassed,
    label: 'CI Passed',
    description: 'A CI run for a branch you pushed from Studio passed.',
    area: 'Continuous Integration',
    default: 'history',
  },
  {
    id: CoreNotificationType.CiFailed,
    label: 'CI Failed',
    description: 'A CI run for a branch you pushed from Studio failed.',
    area: 'Continuous Integration',
    default: 'popup',
  },
  {
    id: CoreNotificationType.PersonaReview,
    label: 'Persona Changes to Review',
    description: 'Pete learned something about you and is waiting for you to approve it.',
    area: 'Persona',
    default: 'popup',
  },
];
