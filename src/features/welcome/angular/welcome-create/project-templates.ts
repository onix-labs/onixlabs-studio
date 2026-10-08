import { Icon } from '@shared/angular/icons/icon';

/**
 * Describes a project template: what the user wants to build, named, and the skill that shapes how the
 * agent plans it. A template shapes the questions the agent asks, never the answers.
 */
export interface ProjectTemplate {
  /**
   * Gets its id, which is also the name of the skill it applies.
   */
  readonly skill: string;

  /**
   * Gets its name.
   */
  readonly title: string;

  /**
   * Gets a line describing it.
   */
  readonly summary: string;

  /**
   * Gets its icon.
   */
  readonly icon: Icon;

  /**
   * Gets what is being built, as the first message says it: "a desktop application".
   */
  readonly goal: string;
}

/**
 * The templates the Start step offers (#806).
 *
 * ⚠️ A fixed list for now; they are to come from the skill library, so a user's or a plugin's own appear
 * beside these.
 */
export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    skill: 'new-desktop-app',
    title: 'Desktop Application',
    summary: 'A native or cross-platform app for Windows, macOS and Linux.',
    icon: Icon.WELCOME_STARTER_DESKTOP,
    goal: 'a desktop application',
  },
  {
    skill: 'new-web-app',
    title: 'Web Application',
    summary: 'A site or app in the browser, with or without a back end.',
    icon: Icon.WELCOME_STARTER_WEB,
    goal: 'a web application',
  },
  {
    skill: 'new-mobile-app',
    title: 'Mobile Application',
    summary: 'An app for iOS, Android, or both.',
    icon: Icon.WELCOME_STARTER_MOBILE,
    goal: 'a mobile application',
  },
  {
    skill: 'new-service',
    title: 'API or Service',
    summary: 'A back-end service, its API, data and deployment.',
    icon: Icon.WELCOME_STARTER_SERVICE,
    goal: 'an API or back-end service',
  },
  {
    skill: 'new-cli-tool',
    title: 'Command-Line Tool',
    summary: 'A tool run from the terminal, and how it is installed.',
    icon: Icon.WELCOME_STARTER_CLI,
    goal: 'a command-line tool',
  },
  {
    skill: 'new-library',
    title: 'Library or Package',
    summary: 'Reusable code, published for others to depend on.',
    icon: Icon.WELCOME_STARTER_LIBRARY,
    goal: 'a library or package for others to use',
  },
  {
    skill: 'new-game',
    title: 'Game',
    summary: 'A game, its engine and the platforms it ships to.',
    icon: Icon.WELCOME_STARTER_GAME,
    goal: 'a game',
  },
];

/**
 * Describes one choice of a project option.
 */
export interface ProjectOptionChoice {
  /**
   * Gets its value.
   */
  readonly value: string;

  /**
   * Gets its label in the dropdown.
   */
  readonly label: string;

  /**
   * Gets how the first message says it, after the option's name: "run it in containers".
   */
  readonly phrase: string;
}

/**
 * Describes one of the Options step's questions. Unanswered, it is left out of the first message.
 */
export interface ProjectOption {
  /**
   * Gets its id.
   */
  readonly id: string;

  /**
   * Gets its name.
   */
  readonly label: string;

  /**
   * Gets its choices.
   */
  readonly choices: readonly ProjectOptionChoice[];
}

/**
 * The Options step's questions (#806). Which tools to use belongs to the Technology step; these are
 * how the project is run.
 */
export const PROJECT_OPTIONS: readonly ProjectOption[] = [
  {
    id: 'containers',
    label: 'Containers',
    choices: [
      { value: 'yes', label: 'Run it in containers', phrase: 'run it in containers' },
      { value: 'no', label: 'No containers', phrase: 'no containers' },
      { value: 'recommend', label: 'Recommend', phrase: 'recommend whether to use them' },
    ],
  },
  {
    id: 'ci',
    label: 'Continuous integration',
    choices: [
      { value: 'yes', label: 'Build and test every change', phrase: 'build and test every change' },
      { value: 'no', label: 'None for now', phrase: 'none for now' },
      { value: 'recommend', label: 'Recommend', phrase: 'recommend a setup' },
    ],
  },
  {
    id: 'tracking',
    label: 'Work tracking',
    choices: [
      {
        value: 'issues',
        label: 'Issues on the code host',
        phrase: 'track the work as issues on the code host',
      },
      {
        value: 'file',
        label: 'A plan file in the project',
        phrase: 'keep a plan file in the project',
      },
      { value: 'none', label: 'None', phrase: 'none' },
    ],
  },
  {
    id: 'licence',
    label: 'Licence',
    choices: [
      { value: 'mit', label: 'MIT', phrase: 'MIT' },
      { value: 'apache-2.0', label: 'Apache 2.0', phrase: 'Apache 2.0' },
      { value: 'gpl-3.0', label: 'GPL 3.0', phrase: 'GPL 3.0' },
      { value: 'proprietary', label: 'Proprietary', phrase: 'proprietary, all rights reserved' },
      { value: 'recommend', label: 'Recommend', phrase: 'recommend one' },
    ],
  },
];
