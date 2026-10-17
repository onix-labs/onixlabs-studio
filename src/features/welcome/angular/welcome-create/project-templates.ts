import { Icon } from '@shared/angular/icons/icon';

/**
 * Names a group of templates.
 */
export type ProjectTemplateGroupId =
  | 'applications'
  | 'services'
  | 'ai'
  | 'data'
  | 'infrastructure'
  | 'extensions'
  | 'libraries'
  | 'games'
  | 'devices'
  | 'other';

/**
 * Describes a group of templates, as the Start step's accordion heads it.
 */
export interface ProjectTemplateGroup {
  /**
   * Gets its id.
   */
  readonly id: ProjectTemplateGroupId;

  /**
   * Gets its name.
   */
  readonly title: string;
}

/**
 * Describes a project template: what the user wants to build, named, and the skill that shapes how the
 * agent plans it. A template shapes the questions the agent asks, never the answers.
 */
export interface ProjectTemplate {
  /**
   * Gets the group it is listed under.
   */
  readonly group: ProjectTemplateGroupId;

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
 * The template groups, in the order the Start step shows them (#806).
 */
export const PROJECT_TEMPLATE_GROUPS: readonly ProjectTemplateGroup[] = [
  { id: 'applications', title: 'Applications' },
  { id: 'services', title: 'Services & APIs' },
  { id: 'ai', title: 'AI' },
  { id: 'data', title: 'Data' },
  { id: 'infrastructure', title: 'Cloud & Infrastructure' },
  { id: 'extensions', title: 'Extensions & Integrations' },
  { id: 'libraries', title: 'Libraries & Developer Tools' },
  { id: 'games', title: 'Games & Graphics' },
  { id: 'devices', title: 'Devices' },
  { id: 'other', title: 'Other' },
];

/**
 * One template row: group, skill, title, summary, icon and goal.
 */
type Row = readonly [ProjectTemplateGroupId, string, string, string, Icon, string];

/**
 * The templates' rows, by group (#806): what people build today, from the familiar application shapes
 * to agents, data and devices.
 */
const ROWS: readonly Row[] = [
  [
    'applications',
    'new-desktop-app',
    'Desktop Application',
    'A native or cross-platform app for Windows, macOS and Linux.',
    Icon.WELCOME_TEMPLATE_DESKTOP,
    'a desktop application',
  ],
  [
    'applications',
    'new-web-app',
    'Web Application',
    'A site or app in the browser, with or without a back end.',
    Icon.WELCOME_TEMPLATE_GLOBE,
    'a web application',
  ],
  [
    'applications',
    'new-mobile-app',
    'Mobile Application',
    'An app for iOS, Android, or both.',
    Icon.WELCOME_TEMPLATE_DEVICE_MOBILE,
    'a mobile application',
  ],
  [
    'applications',
    'new-saas',
    'Full-Stack SaaS',
    'A web product with accounts, billing and more than one customer.',
    Icon.WELCOME_TEMPLATE_STOREFRONT,
    'a full-stack SaaS product',
  ],
  [
    'applications',
    'new-pwa',
    'Progressive Web App',
    'A web app that installs and works offline like a native one.',
    Icon.WELCOME_TEMPLATE_APP_WINDOW,
    'a progressive web app',
  ],
  [
    'applications',
    'new-static-site',
    'Static Site',
    'Documentation, a blog or a marketing site.',
    Icon.WELCOME_TEMPLATE_FILE_HTML,
    'a static website',
  ],
  [
    'applications',
    'new-cli-tool',
    'Command-Line Tool',
    'A tool run from the terminal, and how it is installed.',
    Icon.WELCOME_TEMPLATE_TERMINAL_WINDOW,
    'a command-line tool',
  ],
  [
    'applications',
    'new-terminal-app',
    'Terminal App',
    'An interactive, full-screen app that runs in the terminal.',
    Icon.WELCOME_TEMPLATE_TERMINAL,
    'an interactive terminal application',
  ],
  [
    'services',
    'new-service',
    'API or Service',
    'A back-end service, its API, data and deployment.',
    Icon.WELCOME_TEMPLATE_CLOUD,
    'an API or back-end service',
  ],
  [
    'services',
    'new-graphql-api',
    'GraphQL API',
    'A typed graph of data for clients to query.',
    Icon.WELCOME_TEMPLATE_GRAPH,
    'a GraphQL API',
  ],
  [
    'services',
    'new-microservices',
    'Microservices',
    'Several services that work together, and how they talk.',
    Icon.WELCOME_TEMPLATE_SHARE_NETWORK,
    'a system of microservices',
  ],
  [
    'services',
    'new-serverless',
    'Serverless Functions',
    'Event-driven functions on a cloud platform.',
    Icon.WELCOME_TEMPLATE_LIGHTNING,
    'a set of serverless functions',
  ],
  [
    'services',
    'new-realtime-service',
    'Real-Time Service',
    'Live updates over WebSockets or streams: chat, collaboration, feeds.',
    Icon.WELCOME_TEMPLATE_BROADCAST,
    'a real-time service',
  ],
  [
    'services',
    'new-background-worker',
    'Background Worker',
    'Jobs from a queue or a schedule, run reliably.',
    Icon.WELCOME_TEMPLATE_STACK,
    'a background worker that processes jobs',
  ],
  [
    'ai',
    'new-ai-agent',
    'AI Agent or Assistant',
    'An app built around a language model, with tools and memory.',
    Icon.WELCOME_TEMPLATE_ROBOT,
    'an AI agent',
  ],
  [
    'ai',
    'new-multi-agent',
    'Multi-Agent System',
    'Several agents with different roles working on one goal.',
    Icon.WELCOME_TEMPLATE_USERS_THREE,
    'a multi-agent system',
  ],
  [
    'ai',
    'new-mcp-server',
    'MCP Server',
    "A system's data and actions, offered to AI agents.",
    Icon.WELCOME_TEMPLATE_PLUGS_CONNECTED,
    'an MCP server',
  ],
  [
    'ai',
    'new-rag',
    'Chat with Your Documents',
    'Retrieval over your own content, answered by a model.',
    Icon.WELCOME_TEMPLATE_CHATS_CIRCLE,
    'an app that answers questions from my own documents',
  ],
  [
    'ai',
    'new-ml-model',
    'Machine-Learning Model',
    'Training or fine-tuning a model, evaluating it, and serving it.',
    Icon.WELCOME_TEMPLATE_BRAIN,
    'a machine-learning model',
  ],
  [
    'ai',
    'new-computer-vision',
    'Computer Vision',
    'Understanding images or video: detection, recognition, measurement.',
    Icon.WELCOME_TEMPLATE_EYE,
    'a computer-vision application',
  ],
  [
    'ai',
    'new-voice-app',
    'Voice Application',
    'Speech in and out: transcription, assistants, dictation.',
    Icon.WELCOME_TEMPLATE_MICROPHONE,
    'a voice application',
  ],
  [
    'data',
    'new-data-analysis',
    'Data Analysis',
    'Exploring data in notebooks, and showing what it says.',
    Icon.WELCOME_TEMPLATE_CHART_SCATTER,
    'a data-analysis project',
  ],
  [
    'data',
    'new-data-pipeline',
    'Data Pipeline',
    'Moving and shaping data between systems, on a schedule.',
    Icon.WELCOME_TEMPLATE_FLOW_ARROW,
    'a data pipeline',
  ],
  [
    'data',
    'new-dashboard',
    'Dashboard',
    'Metrics and charts over data you already have.',
    Icon.WELCOME_TEMPLATE_CHART_BAR,
    'a dashboard',
  ],
  [
    'data',
    'new-database',
    'Database',
    'A schema, its migrations, and the data it holds.',
    Icon.WELCOME_TEMPLATE_DATABASE,
    'a database and its schema',
  ],
  [
    'data',
    'new-web-scraper',
    'Web Scraper',
    'Collecting data from websites, politely and repeatably.',
    Icon.WELCOME_TEMPLATE_MAGNIFYING_GLASS,
    'a web scraper',
  ],
  [
    'infrastructure',
    'new-infrastructure-as-code',
    'Infrastructure as Code',
    'An environment described in Terraform, Pulumi or Bicep.',
    Icon.WELCOME_TEMPLATE_CUBE,
    'infrastructure as code',
  ],
  [
    'infrastructure',
    'new-kubernetes',
    'Kubernetes Deployment',
    'Charts, manifests or an operator for running on a cluster.',
    Icon.WELCOME_TEMPLATE_SHIPPING_CONTAINER,
    'a Kubernetes deployment',
  ],
  [
    'infrastructure',
    'new-ci-cd',
    'CI/CD Pipeline',
    'Building, testing and releasing on every change.',
    Icon.WELCOME_TEMPLATE_INFINITY,
    'a CI/CD pipeline',
  ],
  [
    'extensions',
    'new-studio-plugin',
    'ONIXLabs Studio Plugin',
    'A plugin that adds to Studio: a language, a provider, a tool.',
    Icon.WELCOME_TEMPLATE_PUZZLE_PIECE,
    'an ONIXLabs Studio plugin',
  ],
  [
    'extensions',
    'new-editor-extension',
    'Editor Extension',
    'An extension for VS Code, JetBrains IDEs or another editor.',
    Icon.WELCOME_TEMPLATE_CODE,
    'an editor extension',
  ],
  [
    'extensions',
    'new-browser-extension',
    'Browser Extension',
    'An extension for Chrome, Edge, Firefox or Safari.',
    Icon.WELCOME_TEMPLATE_BROWSER,
    'a browser extension',
  ],
  [
    'extensions',
    'new-chat-bot',
    'Chat Bot',
    'A bot for Slack, Discord or Teams.',
    Icon.WELCOME_TEMPLATE_CHAT_CIRCLE_DOTS,
    'a chat bot',
  ],
  [
    'extensions',
    'new-automation',
    'Automation or Workflow',
    'Scripts and jobs that glue services together.',
    Icon.WELCOME_TEMPLATE_REPEAT,
    'an automation workflow',
  ],
  [
    'extensions',
    'new-office-add-in',
    'Office Add-in',
    'An add-in for Word, Excel, Outlook or Google Workspace.',
    Icon.WELCOME_TEMPLATE_FILE_DOC,
    'an office add-in',
  ],
  [
    'libraries',
    'new-library',
    'Library or Package',
    'Reusable code, published for others to depend on.',
    Icon.WELCOME_TEMPLATE_PACKAGE,
    'a library or package for others to use',
  ],
  [
    'libraries',
    'new-sdk',
    'SDK',
    'A client library that makes an API easy to use.',
    Icon.WELCOME_TEMPLATE_TOOLBOX,
    'an SDK for an API',
  ],
  [
    'libraries',
    'new-language-tool',
    'Compiler or Language Tool',
    'A parser, compiler, interpreter or language server.',
    Icon.WELCOME_TEMPLATE_BRACKETS_ANGLE,
    'a compiler or language tool',
  ],
  [
    'libraries',
    'new-developer-tool',
    'Developer Tool',
    'A linter, formatter, generator or other tool for developers.',
    Icon.WELCOME_TEMPLATE_WRENCH,
    'a developer tool',
  ],
  [
    'games',
    'new-game',
    'Game',
    'A game, its engine and the platforms it ships to.',
    Icon.WELCOME_TEMPLATE_GAME_CONTROLLER,
    'a game',
  ],
  [
    'games',
    'new-game-mod',
    'Game Mod',
    'A modification for an existing game.',
    Icon.WELCOME_TEMPLATE_SWORD,
    'a game mod',
  ],
  [
    'games',
    'new-graphics',
    '3D or Graphics',
    'Rendering, simulation or an interactive visualisation.',
    Icon.WELCOME_TEMPLATE_CUBE_FOCUS,
    'a 3D graphics application',
  ],
  [
    'devices',
    'new-embedded',
    'Embedded Firmware',
    'Software for a microcontroller or a dedicated device.',
    Icon.WELCOME_TEMPLATE_CPU,
    'embedded firmware',
  ],
  [
    'devices',
    'new-iot',
    'IoT System',
    'Devices, their messages and the service they report to.',
    Icon.WELCOME_TEMPLATE_CIRCUITRY,
    'an IoT system',
  ],
  [
    'devices',
    'new-smart-home',
    'Smart Home Integration',
    'Automations and integrations for a smart home.',
    Icon.WELCOME_TEMPLATE_HOUSE_LINE,
    'a smart home integration',
  ],
  [
    'other',
    'new-smart-contract',
    'Smart Contract',
    'A contract on a blockchain, and the app that uses it.',
    Icon.WELCOME_TEMPLATE_CUBE_TRANSPARENT,
    'a smart contract and its app',
  ],
  [
    'other',
    'new-prototype',
    'Prototype',
    'A quick proof of concept to try an idea out.',
    Icon.WELCOME_TEMPLATE_FLASK,
    'a quick prototype',
  ],
];

/**
 * The templates the Start step offers (#806).
 *
 * ⚠️ A fixed list for now; they are to come from the skill library, so a user's or a plugin's own appear
 * beside these.
 */
export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = ROWS.map(
  ([group, skill, title, summary, icon, goal]: Row): ProjectTemplate => ({
    group,
    skill,
    title,
    summary,
    icon,
    goal,
  }),
);

/**
 * Determines whether a template matches a search: its name, its summary, or what it builds.
 * @param template The template.
 * @param needle The lower-cased search.
 * @returns Returns true when it matches, or when there is nothing to search for.
 */
export function matchesTemplate(template: ProjectTemplate, needle: string): boolean {
  return (
    needle.length === 0 ||
    template.title.toLowerCase().includes(needle) ||
    template.summary.toLowerCase().includes(needle) ||
    template.goal.toLowerCase().includes(needle)
  );
}

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
