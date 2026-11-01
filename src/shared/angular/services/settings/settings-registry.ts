import type {
  AiConnection,
  AiPermissionPosture,
  AiRemoteControlPosture,
  AiToolPolicy,
  ClaudeExecutableMode,
  CodexExecutableMode,
} from '@shared/api/ai-types';
import { DEFAULT_CONNECTION_ID, SEED_CONNECTIONS } from '@shared/api/ai-types';
import type { LogLevelSetting } from '@shared/api/log-channels';
import type {
  CornerStyle,
  QuitWhenLastWindowCloses,
  WindowSizeOnLaunch,
} from '@shared/api/startup-settings';
import type {
  ApplicationMenuAppearance,
  ApplicationMenuMode,
  BraceStyle,
  CurrentLineHighlightStyle,
  CursorBlinkingStyle,
  CursorSmoothCaretAnimation,
  DiffLayout,
  DocumentDiffSwitch,
  DocumentWellPlacement,
  FileExplorerExpandAll,
  GoToStyle,
  ImageAlignment,
  ImageSizing,
  LanguageOverrides,
  MutedNotifications,
  NotificationColour,
  NotificationStacking,
  MarginSize,
  PrintMargin,
  RibbonAlignment,
  SelectAllScope,
  WorkspaceTexture,
} from './settings';
import { isSettingsOwned } from './settings-schema';
import type { SectionDef, SettingDef, SettingsOwnedDef } from './settings-schema';

/**
 * Maps a connection id to the model the user last selected for it, so switching connections restores
 * the prior model. A missing entry means "use the connection's default model".
 */
export type AiConnectionModels = Readonly<Record<string, string>>;

/**
 * How the Mission Control agent rail scrolls a clicked agent's column into view: the minimal scroll
 * that brings it fully on screen (`into-view`), or aligning its left edge to the start of the row so it
 * sits immediately after the panel (`absolute-left`), which leaves trailing space when the last agents
 * are selected.
 */
export type TileScrollMode = 'into-view' | 'absolute-left';

/**
 * When quitting Studio asks first: always, only while work is running (agents, runs, builds or
 * debugging), or never. Unsaved documents ask to be saved whatever this says.
 */
export type ConfirmBeforeQuitting = 'always' | 'when-working' | 'never';

/**
 * Whether the setup wizard opens after an update that brings something new to it, or never does
 * (it stays reachable from Help).
 */
export type RunSetupAfterUpdates = 'when-new' | 'never';

/**
 * Whether motion is reduced: following the operating system's preference, or on or off whatever it
 * says.
 */
export type ReduceMotion = 'system' | 'on' | 'off';

/**
 * How scroll bars are shown: slim bars that appear while an area is hovered or scrolled, or bars that
 * are always there.
 */
export type ScrollBars = 'auto-hide' | 'always';

/**
 * When the end of a piece of work (an agent's turn, a run or build) is announced with a toast and a
 * system notification: always, only when it failed, or never. It is recorded in the tray either way.
 */
export type FinishNotifications = 'always' | 'failures' | 'never';

/**
 * Defines how large an agent conversation's text renders: its transcript and its prompt.
 */
export type ConversationTextSize = 'small' | 'medium' | 'large';

/**
 * What the Database Explorer does with a query a select action (Select Top 1000 Rows, Match 25
 * Nodes) opens: leave it for the user to run, or run it straight away.
 */
export type DatabaseSelectAction = 'open' | 'open-and-run';

/**
 * Which rules the Database Explorer's results grid draws between its cells.
 */
export type DatabaseGridlines = 'none' | 'horizontal' | 'full';

/**
 * How strongly the Database Explorer's results grid draws its gridlines.
 */
export type DatabaseGridlineTone = 'light' | 'dark';

/**
 * Maps every setting key to the type of value it holds. This is the type-safe contract consumers read
 * through {@link import('./settings').Settings.get}; the runtime {@link SETTINGS_REGISTRY} is checked
 * against these keys, so a registry entry whose key is not declared here is a compile error.
 *
 * Adding a setting is two co-located edits: one entry in the registry and one line here.
 */
export interface SettingsValues {
  readonly 'appearance.ribbonAlignment': RibbonAlignment;
  readonly 'appearance.workspaceTexture': WorkspaceTexture;

  readonly 'application.menuMode': ApplicationMenuMode;
  readonly 'application.menuAppearance': ApplicationMenuAppearance;
  readonly 'application.showWindowLock': boolean;
  readonly 'application.cornerStyle': CornerStyle;
  readonly 'application.windowSizeOnLaunch': WindowSizeOnLaunch;
  readonly 'application.restoreFullScreen': boolean;
  readonly 'application.quitWhenLastWindowCloses': QuitWhenLastWindowCloses;
  readonly 'application.confirmBeforeQuitting': ConfirmBeforeQuitting;
  readonly 'application.runSetupAfterUpdates': RunSetupAfterUpdates;

  readonly 'accessibility.showTooltips': boolean;
  readonly 'accessibility.tooltipDelay': number;
  readonly 'accessibility.reduceMotion': ReduceMotion;
  readonly 'accessibility.scrollBars': ScrollBars;

  readonly 'notifications.toastDuration': number;
  readonly 'notifications.agentRequestToasts': boolean;
  readonly 'notifications.desktop': boolean;
  readonly 'notifications.stacking': NotificationStacking;
  readonly 'notifications.colour': NotificationColour;
  readonly 'notifications.whenMuted': MutedNotifications;
  readonly 'notifications.maxToasts': number;
  readonly 'notifications.rememberMute': boolean;
  readonly 'notifications.errorsStay': boolean;
  readonly 'notifications.desktopErrors': boolean;
  readonly 'notifications.agentFinished': FinishNotifications;
  readonly 'notifications.runFinished': FinishNotifications;

  readonly 'workspaces.fileExplorerExpandAll': FileExplorerExpandAll;
  readonly 'workspaces.documentDiffSwitch': DocumentDiffSwitch;
  readonly 'workspaces.documentWellPlacement': DocumentWellPlacement;

  readonly 'textEditor.global.showLineNumbers': boolean;
  readonly 'textEditor.global.showMinimap': boolean;
  readonly 'textEditor.global.currentLineHighlight': CurrentLineHighlightStyle;
  readonly 'textEditor.global.colorBrackets': boolean;
  readonly 'textEditor.global.accentSelection': boolean;
  readonly 'textEditor.global.wordWrap': boolean;
  readonly 'textEditor.global.stickyScroll': boolean;
  readonly 'textEditor.global.formatOnType': boolean;
  readonly 'textEditor.global.cursorBlinking': CursorBlinkingStyle;
  readonly 'textEditor.global.cursorSmoothCaretAnimation': CursorSmoothCaretAnimation;
  readonly 'textEditor.global.insertSpaces': boolean;
  readonly 'textEditor.global.tabSize': number;
  readonly 'textEditor.global.fontFamily': string;
  readonly 'textEditor.global.fontSize': number;
  readonly 'textEditor.global.lineHeight': number;
  readonly 'textEditor.global.braceStyle': BraceStyle;
  readonly 'textEditor.goToStyle': GoToStyle;
  readonly 'textEditor.diffLayout': DiffLayout;
  readonly 'textEditor.languageOverrides': LanguageOverrides;
  readonly 'textEditor.printMargin': PrintMargin;

  readonly 'markdownEditor.fontFamily': string;
  readonly 'markdownEditor.monospaceFontFamily': string;
  readonly 'markdownEditor.fontSize': number;
  readonly 'markdownEditor.marginSize': MarginSize;
  readonly 'markdownEditor.imageSizing': ImageSizing;
  readonly 'markdownEditor.imageAlignment': ImageAlignment;
  readonly 'markdownEditor.selectAllScope': SelectAllScope;
  readonly 'markdownEditor.printMargin': PrintMargin;

  readonly 'terminal.defaultShell': string;

  readonly 'keyboard.overrides': Readonly<Record<string, string>>;

  readonly 'ai.connections': readonly AiConnection[];
  readonly 'ai.activeConnectionId': string;
  readonly 'ai.connectionModels': AiConnectionModels;
  readonly 'ai.connectionsFormat': number;
  readonly 'ai.autoScroll': boolean;
  readonly 'ai.conversationTextSize': ConversationTextSize;
  readonly 'ai.reportBackgroundTasks': boolean;
  readonly 'ai.permissionPosture': AiPermissionPosture;
  readonly 'ai.remoteControlPosture': AiRemoteControlPosture;
  readonly 'ai.toolPolicies': Readonly<Record<string, AiToolPolicy>>;
  readonly 'ai.blockHostCommandLine': boolean;
  readonly 'ai.allowedWritePaths': readonly string[];
  readonly 'ai.deniedWritePaths': readonly string[];
  readonly 'ai.allowedNetworkLocations': readonly string[];
  readonly 'ai.deniedNetworkLocations': readonly string[];
  readonly 'ai.tokenCap': number;
  readonly 'ai.runTimeoutMinutes': number;
  readonly 'ai.agentSessionLifetime': number;
  readonly 'ai.agentShell': string;
  readonly 'ai.claudeExecutable': ClaudeExecutableMode;
  readonly 'ai.claudeExecutablePath': string;
  readonly 'ai.codexExecutable': CodexExecutableMode;
  readonly 'ai.codexExecutablePath': string;

  readonly 'missionControl.tileScrollMode': TileScrollMode;

  readonly 'systemMonitor.refreshRate': number;
  readonly 'systemMonitor.logLevel': LogLevelSetting;

  readonly 'databaseExplorer.selectAction': DatabaseSelectAction;
  readonly 'databaseExplorer.gridlines': DatabaseGridlines;
  readonly 'databaseExplorer.gridlineTone': DatabaseGridlineTone;
}

/**
 * Identifies any setting by its stable key.
 */
export type SettingsKey = keyof SettingsValues;

/**
 * Holds the settings registry: the single source of truth for every Settings-service-owned setting,
 * its defaults, and how it is rendered. Adding a scalar setting is one entry here plus its line in
 * {@link SettingsValues}.
 */
export const SETTINGS_REGISTRY: readonly SectionDef[] = [
  {
    id: 'application',
    label: 'Application',
    settings: [
      {
        key: 'display.graphicsAcceleration',
        owner: 'display',
        // Collapsed out of three separate switches in this release, so an upgrading user has never
        // seen it and the wizard puts the appearance step in front of them once.
        since: '2026.1.0-beta.4',
        title: 'Graphics Acceleration',
        description:
          'How much of the GPU the interface uses. Full shows every effect; Limited drops the ' +
          'heavier ones for hardware that struggles; Off can fix rendering glitches but makes the ' +
          'interface lag. Turning acceleration on or off restarts Studio.',
        shortDescription:
          'How much of the GPU the interface uses. Leave this automatic unless the interface ' +
          'renders oddly or lags; changing it restarts Studio.',
        control: {
          kind: 'select',
          options: [
            { value: 'auto', label: 'Automatic' },
            { value: 'off', label: 'Off' },
            { value: 'limited', label: 'Limited' },
            { value: 'full', label: 'Full' },
          ],
        },
        requiresRestart: true,
      },
      {
        key: 'application.cornerStyle',
        title: 'Corner Style',
        description:
          'The shape of corners across the interface. Automatic draws squircles when Graphics ' +
          'Acceleration is at Full, and rounded corners below it.',
        control: {
          kind: 'select',
          options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'squircle', label: 'Squircle' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'square', label: 'Square' },
          ],
        },
        default: 'automatic',
      },
      {
        key: 'appearance.themeMode',
        owner: 'theme',
        title: 'Theme',
        description: 'Light, dark, or follow the operating system.',
        control: {
          kind: 'select',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ],
        },
      },
      {
        key: 'appearance.accent',
        owner: 'theme',
        title: 'Accent',
        description:
          'The colour used for highlights and focus. Pick a preset, or choose Custom for any hue.',
        control: { kind: 'accent' },
      },
      {
        key: 'application.menuMode',
        title: 'Application Menu',
        description:
          'How much of the File, Edit and View menu the title strip carries. Hide it when the ' +
          'system already draws the menu itself; the button takes the least room; the full menu ' +
          'puts every section a single click away.',
        control: {
          kind: 'select',
          options: [
            { value: 'hidden', label: 'Hide' },
            { value: 'icon', label: 'Show Menu Icon' },
            { value: 'full', label: 'Show Full Menu' },
          ],
        },
        default: 'icon',
      },
      {
        key: 'application.menuAppearance',
        title: 'Application Menu Appearance',
        description:
          'How the menu button lays its sections out when opened: stacked as a list, or across a ' +
          'strip with each section opening beneath it.',
        control: {
          kind: 'select',
          options: [
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
          ],
        },
        // Only the button lays its sections out; hidden has none to lay out and the full menu is a
        // bar already, so the choice would be inert in both.
        visibleWhen: { key: 'application.menuMode', equals: ['icon'] },
        default: 'vertical',
      },
      {
        key: 'appearance.ribbonAlignment',
        title: 'Ribbon Alignment',
        description: "How the ribbon's controls are aligned within the ribbon strip.",
        control: {
          kind: 'select',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
          ],
        },
        default: 'left',
      },
      {
        key: 'application.windowSizeOnLaunch',
        title: 'Window Size on Launch',
        description:
          'How large the window opens: as you last left it, at the default size in the middle ' +
          'of the screen, or maximised.',
        control: {
          kind: 'select',
          options: [
            { value: 'remember', label: 'Remember Last' },
            { value: 'default', label: 'Default Size' },
            { value: 'maximised', label: 'Always Maximised' },
          ],
        },
        default: 'remember',
      },
      {
        key: 'application.restoreFullScreen',
        title: 'Restore Full Screen',
        description: 'Open in full screen when Studio was last closed in full screen.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'application.quitWhenLastWindowCloses',
        title: 'Quit When the Last Window Closes',
        description:
          'Closing the window keeps Studio running in the Dock, with your work as you left it, ' +
          'or quits Studio.',
        control: {
          kind: 'select',
          options: [
            { value: 'keep-running', label: 'Keep Running' },
            { value: 'quit', label: 'Quit' },
          ],
        },
        platforms: ['darwin'],
        default: 'keep-running',
      },
      {
        key: 'application.confirmBeforeQuitting',
        title: 'Confirm Before Quitting',
        description:
          'Ask before Studio quits, or before its window closes while it keeps running: always, ' +
          'only while agents, runs, builds or debugging are running, or never. Unsaved documents ' +
          'always ask to be saved.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'when-working', label: 'When Work Is Running' },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'when-working',
      },
      {
        key: 'application.runSetupAfterUpdates',
        title: 'Run Setup After Updates',
        description:
          'Open the setup wizard after an update that brings something new to it. It is always ' +
          'there from the Help menu.',
        control: {
          kind: 'select',
          options: [
            { value: 'when-new', label: "When Something's New" },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'when-new',
      },
      {
        key: 'application.showWindowLock',
        title: 'Window Lock Switch',
        description:
          'Show the switch at the start of the title strip that pins the window in place. ' +
          'Turning this off also releases the lock.',
        control: { kind: 'toggle' },
        default: true,
      },
    ],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    settings: [
      {
        key: 'accessibility.showTooltips',
        title: 'Tooltips on Icon-Only Controls',
        description:
          'Name a control that shows only an icon, in a tooltip below it, on hover or keyboard ' +
          'focus. These controls always carry their name for a screen reader; this shows the same ' +
          'name to everyone else. Controls with visible text are unaffected.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'accessibility.tooltipDelay',
        title: 'Tooltip Delay',
        description: 'How long the pointer rests on a control before its tooltip appears.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Instant' },
            { value: '500', label: 'Short (½ second)' },
            { value: '1000', label: 'Long (1 second)' },
          ],
        },
        visibleWhen: { key: 'accessibility.showTooltips', equals: [true] },
        default: 0,
      },
      {
        key: 'accessibility.reduceMotion',
        title: 'Reduce Motion',
        description:
          'Turn off animations, smooth scrolling and the smooth caret. Follow System does this ' +
          'when the operating system is set to reduce motion.',
        control: {
          kind: 'select',
          options: [
            { value: 'system', label: 'Follow System' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
        default: 'system',
      },
      {
        key: 'accessibility.scrollBars',
        title: 'Scroll Bars',
        description:
          'Show scroll bars only while an area is hovered or scrolling, or always. Editors and ' +
          'terminals draw their own.',
        control: {
          kind: 'select',
          options: [
            { value: 'auto-hide', label: 'Auto-Hide' },
            { value: 'always', label: 'Always Show' },
          ],
        },
        default: 'auto-hide',
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    settings: [
      {
        key: 'notifications.toastDuration',
        title: 'Toast Duration',
        description:
          'How long a transient notification toast stays on screen. Hovering a toast pauses its ' +
          'timer; errors stay until dismissed while Errors Stay Until Dismissed is on.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '5', label: '5 seconds' },
            { value: '10', label: '10 seconds' },
            { value: '15', label: '15 seconds' },
            { value: '30', label: '30 seconds' },
            { value: '60', label: '1 minute' },
          ],
        },
        default: 5,
      },
      {
        key: 'notifications.agentRequestToasts',
        title: 'Agent Requests as Toasts',
        description:
          'Raise a toast when an agent in a background tab asks a question or requests permission. ' +
          'Answering stays in the conversation; the toast jumps to the asking tab.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'notifications.desktop',
        title: 'System Notifications',
        description:
          'While Studio is in the background, show errors, finished agents, runs and builds, and ' +
          "agents waiting on you in the system's notification centre. Clicking one brings Studio " +
          'back to what it is about.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'notifications.stacking',
        title: 'Stacking',
        description:
          'How notifications stack: in a column growing up the screen, or receding behind the ' +
          'newest, which alone can be read and pressed until it is dismissed.',
        control: {
          kind: 'select',
          options: [
            { value: 'upwards', label: 'Upwards' },
            { value: 'backwards', label: 'Backwards' },
          ],
        },
        default: 'upwards',
      },
      {
        key: 'notifications.colour',
        title: 'Colour',
        description:
          "Which notifications show their severity's colour: all of them, or only the newest, with " +
          'the rest in grey until they become the newest.',
        control: {
          kind: 'select',
          options: [
            { value: 'all', label: 'All notifications' },
            { value: 'newest', label: 'Newest only' },
          ],
        },
        default: 'all',
      },
      {
        key: 'notifications.whenMuted',
        title: 'When Muted',
        description:
          'What still appears while notifications are muted from the tray. Muted notifications are ' +
          'still recorded in the tray.',
        control: {
          kind: 'select',
          options: [
            { value: 'nothing', label: 'Show nothing' },
            { value: 'errors', label: 'Show errors only' },
          ],
        },
        default: 'nothing',
      },
      {
        key: 'notifications.rememberMute',
        title: 'Remember Mute Across Launches',
        description: 'Start Studio muted when it was muted as it quit.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'notifications.maxToasts',
        title: 'Maximum Toasts Shown',
        description:
          'How many notifications can be on screen at once. Beyond it, the oldest one that is ' +
          'not an error makes way.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: '1' },
            { value: '3', label: '3' },
            { value: '5', label: '5' },
            { value: '10', label: '10' },
          ],
        },
        default: 5,
      },
      {
        key: 'notifications.errorsStay',
        title: 'Errors Stay Until Dismissed',
        description:
          'Keep an error on screen until you dismiss it, rather than letting it time out.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'notifications.desktopErrors',
        title: 'System Notifications for Errors',
        description:
          "Show every error in the system's notification centre while Studio is in the background.",
        control: { kind: 'toggle' },
        visibleWhen: { key: 'notifications.desktop', equals: [true] },
        default: true,
      },
      {
        key: 'notifications.agentFinished',
        title: 'Notify When an Agent Finishes',
        description:
          'Announce an agent finishing its turn or a background task: always, only when it ' +
          'fails, or never. It is recorded in the notification tray either way.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'failures', label: 'Failures Only' },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'always',
      },
      {
        key: 'notifications.runFinished',
        title: 'Notify When a Run or Build Finishes',
        description:
          'Announce a run or build ending on its own: always, only when it fails, or never. It ' +
          'is recorded in the notification tray either way.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'failures', label: 'Failures Only' },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'always',
      },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    settings: [
      {
        key: 'workspaces.fileExplorerExpandAll',
        title: 'Expand All Scope',
        description:
          "How the File Explorer's Expand All button behaves. Loaded folders only expands directories already read from disk; Entire tree reads and expands the whole workspace (slower on large folders).",
        control: {
          kind: 'select',
          options: [
            { value: 'loaded-only', label: 'Loaded folders only' },
            { value: 'entire-tree', label: 'Entire tree' },
          ],
        },
        default: 'loaded-only',
      },
      {
        key: 'workspaces.documentDiffSwitch',
        title: 'Switching Between a File and Its Diff',
        description:
          "What the Show Differences and Show File buttons on a file's and a diff's tool strips do with the tab you are leaving. Open as a separate tab keeps both, opening the other view beside it (or going to it when it is already open); Replace the current tab turns the tab into the other view, asking to save a file with unsaved changes first.",
        control: {
          kind: 'select',
          options: [
            { value: 'tab', label: 'Open as a separate tab' },
            { value: 'swap', label: 'Replace the current tab' },
          ],
        },
        default: 'tab',
      },
      {
        key: 'workspaces.documentWellPlacement',
        title: 'Opening a Document Beside a Filling Panel',
        description:
          'What happens when you open a document while a panel, such as an agent, fills the space documents open in. Split Horizontally puts the documents beside the panel; Split Vertically puts them above it; Collapse folds the panel into its tab strip, where it can still be opened over the documents, and gives the documents the whole space. Closing the last document gives the panel its space back.',
        control: {
          kind: 'select',
          options: [
            { value: 'split-horizontal', label: 'Split Horizontally' },
            { value: 'split-vertical', label: 'Split Vertically' },
            { value: 'collapse', label: 'Collapse' },
          ],
        },
        default: 'split-horizontal',
      },
      {
        key: 'appearance.workspaceTexture',
        // Shown only at the full level, which is where the texture is actually painted. Below it the
        // texture resolves to nothing regardless of the choice — a full-workspace masked layer is
        // among the costliest things to draw — so the control would do nothing, which reads as broken
        // rather than as inapplicable. The condition tests the *resolved* level, so the automatic mode
        // shows or hides the row according to what it actually resolved to on this machine.
        visibleWhen: { key: 'display.graphicsAcceleration', equals: ['full'] },
        title: 'Workspace Texture',
        description:
          'A pattern tiled behind the workspace panes, painted in the accent colour. Patterns from Hero Patterns.',
        control: {
          kind: 'select',
          options: [
            { value: 'none', label: 'None' },
            { value: 'texture', label: 'Texture' },
            { value: 'hideout', label: 'Hideout' },
            { value: 'tiny-checkers', label: 'Tiny Checkers' },
            { value: 'bubbles', label: 'Bubbles' },
            { value: 'diagonal-stripes', label: 'Diagonal Stripes' },
            { value: 'houndstooth', label: 'Houndstooth' },
            { value: 'rain', label: 'Rain' },
            { value: 'circuit-board', label: 'Circuit Board' },
            { value: 'diagonal-lines', label: 'Diagonal Lines' },
            { value: 'polka-dots', label: 'Polka Dots' },
            { value: 'signal', label: 'Signal' },
          ],
        },
        default: 'none',
      },
    ],
  },
  {
    // Code-wide behaviour that is neither how code looks nor how a language is edited.
    id: 'code-general',
    label: 'Code',
    settings: [
      {
        key: 'textEditor.goToStyle',
        title: 'Go to Style',
        description:
          'How Go to Symbol and Go to Line ask where to go: a quick-open box at the top of the window, or a dialog.',
        control: {
          kind: 'select',
          options: [
            { value: 'quick-open', label: 'Quick-open box' },
            { value: 'dialogs', label: 'Dialogs' },
          ],
        },
        default: 'quick-open',
      },
      {
        key: 'textEditor.diffLayout',
        title: 'Default Diff Layout',
        description:
          "How a diff lays out the two versions it compares when it opens: side by side, or inline in one column. The diff's own Split and Inline switch changes it from there.",
        control: {
          kind: 'select',
          options: [
            { value: 'side-by-side', label: 'Side by Side' },
            { value: 'inline', label: 'Inline' },
          ],
        },
        default: 'side-by-side',
      },
    ],
  },
  {
    // How code looks wherever it appears: editor tabs, diffs, queries, request bodies, Markdown code blocks.
    id: 'code-appearance',
    label: 'Code Appearance',
    settings: [
      {
        key: 'textEditor.global.fontFamily',
        title: 'Font Family',
        description: 'The editor font family.',
        control: {
          kind: 'select',
          options: [{ value: 'JetBrains Mono', label: 'JetBrains Mono' }],
        },
        default: 'JetBrains Mono',
      },
      {
        key: 'textEditor.global.fontSize',
        title: 'Font Size',
        description: 'The editor font size in pixels.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '12', label: '12' },
            { value: '14', label: '14' },
            { value: '16', label: '16' },
            { value: '18', label: '18' },
            { value: '20', label: '20' },
            { value: '22', label: '22' },
            { value: '24', label: '24' },
            { value: '26', label: '26' },
            { value: '28', label: '28' },
            { value: '30', label: '30' },
            { value: '32', label: '32' },
          ],
        },
        default: 14,
      },
      {
        key: 'textEditor.global.lineHeight',
        title: 'Line Height',
        description:
          'The line height as a multiple of the font size; Auto derives it automatically.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Auto' },
            { value: '1', label: '1.0' },
            { value: '1.1', label: '1.1' },
            { value: '1.2', label: '1.2' },
            { value: '1.3', label: '1.3' },
            { value: '1.4', label: '1.4' },
            { value: '1.5', label: '1.5' },
            { value: '1.6', label: '1.6' },
            { value: '1.7', label: '1.7' },
            { value: '1.8', label: '1.8' },
            { value: '1.9', label: '1.9' },
            { value: '2', label: '2.0' },
          ],
        },
        default: 0,
      },
      {
        key: 'textEditor.global.currentLineHighlight',
        title: 'Current Line Highlight',
        description: 'The highlight style applied to the current line.',
        control: {
          kind: 'select',
          options: [
            { value: 'outline', label: 'Outline' },
            { value: 'filled', label: 'Filled' },
          ],
        },
        default: 'outline',
      },
      {
        key: 'textEditor.global.cursorBlinking',
        title: 'Cursor Blinking',
        description: 'The cursor blinking animation style.',
        control: {
          kind: 'select',
          options: [
            { value: 'blink', label: 'Blink' },
            { value: 'smooth', label: 'Smooth' },
            { value: 'phase', label: 'Phase' },
            { value: 'expand', label: 'Expand' },
            { value: 'solid', label: 'Solid' },
          ],
        },
        default: 'blink',
      },
      {
        key: 'textEditor.global.cursorSmoothCaretAnimation',
        title: 'Smooth Caret Animation',
        description: 'How the cursor animates as it moves between positions.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
            { value: 'explicit', label: 'Explicit' },
          ],
        },
        default: 'off',
      },
      {
        key: 'textEditor.global.showLineNumbers',
        title: 'Line Numbers',
        description: 'Show line numbers in the gutter.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.showMinimap',
        title: 'Minimap',
        description: 'Show the minimap.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.colorBrackets',
        title: 'Coloured Brackets',
        description: 'Colour matching bracket pairs by their nesting depth.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.accentSelection',
        title: 'Accent Selection',
        description:
          'Use the accent colour for selected text in the editor (off uses the default).',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.stickyScroll',
        title: 'Sticky Scroll',
        description: 'Pin scope context to the top while scrolling.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.printMargin',
        title: 'Print Margins',
        description:
          'The page margin applied when printing or exporting a code document to PDF. Regular is double ' +
          'Narrow, and Wide is double Regular.',
        control: {
          kind: 'select',
          options: [
            { value: 'narrow', label: 'Narrow' },
            { value: 'regular', label: 'Regular' },
            { value: 'wide', label: 'Wide' },
          ],
        },
        default: 'regular',
      },
    ],
  },
  {
    // How code is edited; the per-language overrides are edited on each language's page under Code › Languages.
    id: 'code-editing',
    label: 'Code Editing',
    settings: [
      {
        key: 'textEditor.global.tabSize',
        title: 'Tab Size',
        description: 'The number of spaces a single indentation level occupies.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '2', label: '2' },
            { value: '4', label: '4' },
            { value: '6', label: '6' },
            { value: '8', label: '8' },
          ],
        },
        profileOverridable: true,
        default: 2,
      },
      {
        key: 'textEditor.global.insertSpaces',
        title: 'Insert Spaces',
        description: 'Insert spaces instead of tabs when indenting.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.wordWrap',
        title: 'Word Wrap',
        description: 'Wrap long lines.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        // On everywhere by default, overridable per language (Matthew's ruling on #1141) — switch it off
        // for, say, TypeScript in a project that a different formatter lays out.
        key: 'textEditor.global.formatOnType',
        title: 'Format on Type',
        description:
          "Lay out the line as you type a closing brace, a semicolon or a new line, using the language's own formatter.",
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.braceStyle',
        title: 'Brace Style',
        description: 'The brace placement style the editor formats to.',
        control: {
          kind: 'select',
          options: [
            { value: 'kr', label: 'K&R (same line)' },
            { value: 'allman', label: 'Allman (own line)' },
            { value: 'gnu', label: 'GNU (own line, indented)' },
          ],
        },
        profileOverridable: true,
        default: 'kr',
      },
      {
        key: 'textEditor.languageOverrides',
        title: 'Language Overrides',
        description:
          'Per-language overrides of the code settings, edited on each language page under Code › Languages.',
        control: { kind: 'custom', component: 'language-editor-overrides' },
        // C# ships with Allman braces, its own convention and Roslyn's default, over the global K&R —
        // an ordinary override, so the user can change or clear it like any other (#1177).
        default: { csharp: { braceStyle: 'allman' } },
      },
    ],
  },
  {
    id: 'markdown',
    label: 'Markdown',
    settings: [
      {
        key: 'markdownEditor.fontFamily',
        title: 'Body Font',
        description: 'Font family used for body text.',
        control: {
          kind: 'select',
          options: [{ value: 'System Default', label: 'System Default' }],
        },
        default: 'System Default',
      },
      {
        key: 'markdownEditor.monospaceFontFamily',
        title: 'Monospace Font',
        description: 'Font family used for code blocks.',
        control: {
          kind: 'select',
          options: [{ value: 'JetBrains Mono', label: 'JetBrains Mono' }],
        },
        default: 'JetBrains Mono',
      },
      {
        key: 'markdownEditor.fontSize',
        title: 'Font Size',
        description: 'Base font size in pixels.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '12', label: '12' },
            { value: '14', label: '14' },
            { value: '16', label: '16' },
            { value: '18', label: '18' },
            { value: '20', label: '20' },
            { value: '22', label: '22' },
            { value: '24', label: '24' },
            { value: '26', label: '26' },
            { value: '28', label: '28' },
            { value: '30', label: '30' },
            { value: '32', label: '32' },
          ],
        },
        default: 16,
      },
      {
        key: 'markdownEditor.marginSize',
        title: 'Container Width',
        description:
          'Maximum content width. Content is centred and capped at this width, and becomes fluid when the editor is narrower.',
        control: {
          kind: 'select',
          options: [
            { value: 'narrow', label: 'Narrow (1024px)' },
            { value: 'medium', label: 'Medium (1440px)' },
            { value: 'wide', label: 'Wide (1600px)' },
            { value: 'full-width', label: 'Full width' },
          ],
        },
        default: 'medium',
      },
      {
        key: 'markdownEditor.imageSizing',
        title: 'Image Sizing',
        description: 'How images are sized in the document.',
        control: {
          kind: 'select',
          options: [
            { value: 'fixed', label: 'Fixed' },
            { value: 'sizable', label: 'Sizable' },
          ],
        },
        default: 'fixed',
      },
      {
        key: 'markdownEditor.imageAlignment',
        title: 'Image Alignment',
        description: 'How images are horizontally aligned in the document.',
        control: {
          kind: 'select',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ],
        },
        default: 'left',
      },
      {
        key: 'markdownEditor.selectAllScope',
        title: 'Select All (Cmd/Ctrl+A)',
        description:
          'What Select All selects first. The Shift chord (Cmd/Ctrl+Shift+A) selects the other one.',
        control: {
          kind: 'select',
          options: [
            { value: 'block', label: 'Current block' },
            { value: 'document', label: 'Whole document' },
          ],
        },
        default: 'block',
      },
      {
        key: 'markdownEditor.printMargin',
        title: 'Print Margins',
        description:
          'The page margin applied when printing or exporting a Markdown document to PDF. Regular is double ' +
          'Narrow, and Wide is double Regular.',
        control: {
          kind: 'select',
          options: [
            { value: 'narrow', label: 'Narrow' },
            { value: 'regular', label: 'Regular' },
            { value: 'wide', label: 'Wide' },
          ],
        },
        default: 'regular',
      },
    ],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    settings: [
      {
        key: 'terminal.defaultShell',
        title: 'Default Shell',
        description:
          'The shell a new terminal starts with. Choose from the shells installed on your system, or use the system default.',
        control: { kind: 'custom', component: 'terminal-default-shell' },
        default: '',
      },
    ],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    settings: [
      {
        key: 'keyboard.overrides',
        title: 'Shortcuts',
        description: 'The keyboard shortcuts for each view, customisable per command.',
        control: { kind: 'custom', component: 'keyboard-bindings' },
        default: {},
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    settings: [
      {
        key: 'ai.connections',
        title: 'Connections',
        description:
          'The configured AI provider connections (each a back-end, credential, and model list).',
        control: { kind: 'custom', component: 'ai-connections' },
        default: SEED_CONNECTIONS,
      },
      {
        key: 'ai.activeConnectionId',
        title: 'Active Connection',
        description: 'The connection the agent runs turns through.',
        control: { kind: 'custom', component: 'ai-connections' },
        default: DEFAULT_CONNECTION_ID,
      },
      {
        key: 'ai.connectionModels',
        title: 'Selected Models',
        description:
          "The model last selected per connection. A missing entry uses the connection's default.",
        control: { kind: 'custom', component: 'ai-connections' },
        default: {},
      },
      {
        key: 'ai.connectionsFormat',
        title: 'Connections Format',
        description:
          'The format the stored connections are in. Written by the settings migration, never by hand.',
        control: { kind: 'custom', component: 'ai-connections' },
        default: 1,
      },
      {
        key: 'ai.autoScroll',
        title: 'Auto-Scroll Transcripts',
        description:
          'Keep agent conversations pinned to the newest message as the response streams. Scrolling ' +
          'up pauses the follow; scrolling back to the bottom resumes it. Applies to every agent view.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'ai.conversationTextSize',
        title: 'Conversation Text Size',
        description:
          'How large agent conversations render: the transcript, and the prompt you type into. ' +
          'Applies to every agent view.',
        control: {
          kind: 'select',
          options: [
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ],
        },
        default: 'medium',
      },
      {
        key: 'ai.reportBackgroundTasks',
        title: 'Report Background Tasks Back',
        description:
          'When a task the agent backgrounded finishes, let the agent pick the conversation back up ' +
          'and tell you what it found, rather than only noting that it finished. The agent resumes on ' +
          'its own and spends tokens to do it, so turn this off to keep an idle conversation idle.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'ai.permissionPosture',
        title: 'Permission Posture',
        description: 'How much the agent may do without asking first.',
        control: {
          kind: 'select',
          options: [
            { value: 'prompt', label: 'Ask every time' },
            { value: 'auto-edits', label: 'Auto-allow file edits' },
            { value: 'auto-all', label: 'Auto-allow everything' },
          ],
        },
        default: 'prompt',
      },
      {
        key: 'ai.remoteControlPosture',
        title: 'Remote Control Posture',
        description:
          'How much a remote peer may do on an agent you expose. Each agent chooses only whether it ' +
          'is exposed; this decides what that exposure means.',
        control: {
          kind: 'select',
          options: [
            { value: 'control', label: 'Full Control' },
            { value: 'mirror', label: 'Read-Only' },
          ],
        },
        default: 'control',
      },
      {
        key: 'ai.toolPolicies',
        title: 'Tool Permissions',
        description:
          'Default allow/ask/deny per tool. Deny blocks a tool even when the posture would ' +
          'auto-allow it; Allow skips the prompt; Ask uses the posture above.',
        control: { kind: 'custom', component: 'ai-tool-policies' },
        default: {},
      },
      {
        key: 'ai.blockHostCommandLine',
        title: "Keep Agents off the Code Host's Command-Line Tool",
        description:
          "While a code-hosting plugin serves the repository, agents may not run that host's own " +
          'command-line tool (gh for GitHub) and go through the plugin instead, which asks before it ' +
          'changes anything. Enforced for Claude and for providers that run commands through ' +
          "Studio's terminal; Codex is only told.",
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'ai.allowedWritePaths',
        title: 'Allowed Write Paths',
        description:
          'Extra directories the agent may write to beyond the workspace root (absolute paths).',
        control: { kind: 'custom', component: 'ai-write-paths' },
        default: [],
      },
      {
        key: 'ai.deniedWritePaths',
        title: 'Denied Write Paths',
        description:
          'Paths the agent may never write to, even inside the workspace: an absolute path, or a ' +
          'name matched anywhere in the path (e.g. .git, .env).',
        control: { kind: 'custom', component: 'ai-write-paths' },
        default: [],
      },
      {
        key: 'ai.allowedNetworkLocations',
        title: 'Allowed Network Locations',
        description:
          'Hosts the agent may reach (e.g. api.example.com, *.corp.example). Empty allows any ' +
          'host, as before. Applies to the agent\u2019s shell and web access through the OS sandbox, ' +
          'and to requests it sends with the API tools; cloud metadata addresses are always blocked. ' +
          'Codex has no per-host control, so a non-empty list turns its network access off entirely.',
        control: { kind: 'custom', component: 'ai-network-locations' },
        default: [],
      },
      {
        key: 'ai.deniedNetworkLocations',
        title: 'Denied Network Locations',
        description:
          'Hosts the agent may never reach, even when the allowed list would permit them.',
        control: { kind: 'custom', component: 'ai-network-locations' },
        default: [],
      },
      {
        key: 'ai.tokenCap',
        title: 'Token Cap',
        description: 'The per-request token budget.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Default (no cap)' },
            { value: '4000', label: '4,000' },
            { value: '8000', label: '8,000' },
            { value: '16000', label: '16,000' },
            { value: '32000', label: '32,000' },
            { value: '64000', label: '64,000' },
            { value: '128000', label: '128,000' },
          ],
        },
        default: 0,
      },
      {
        key: 'ai.runTimeoutMinutes',
        title: 'Run Time Limit',
        description:
          'Aborts a run after this long. The clock pauses while the agent waits for your input.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'No limit' },
            { value: '1', label: '1 minute' },
            { value: '2', label: '2 minutes' },
            { value: '5', label: '5 minutes' },
            { value: '10', label: '10 minutes' },
            { value: '30', label: '30 minutes' },
            { value: '60', label: '60 minutes' },
          ],
        },
        default: 10,
      },
      {
        key: 'ai.agentSessionLifetime',
        title: 'Keep Agent Sessions Alive For',
        description:
          'How long an idle agent keeps its live session — and its background process — before it is ' +
          'reaped to free resources. The conversation reopens transparently on your next message, ' +
          'keeping its context. "Indefinitely" never reaps on idle, though a memory-pressure safety ' +
          'valve still caps how many sessions stay live at once.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '30', label: '30 minutes' },
            { value: '60', label: '60 minutes' },
            { value: '1440', label: '1 day' },
            { value: '0', label: 'Indefinitely' },
          ],
        },
        default: 60,
      },
      {
        key: 'ai.agentShell',
        title: 'Agent Shell',
        description:
          'The shell whose profile the agent sources its environment (PATH, tokens) from. Choose an ' +
          'installed shell, or use the default login shell.',
        control: { kind: 'custom', component: 'ai-agent-shell' },
        default: '',
      },
      {
        key: 'ai.claudeExecutable',
        title: 'Claude CLI',
        description:
          'Which Claude Code CLI the Claude (local login) agent uses, for both running turns and ' +
          'discovering models. Bundled comes with the Claude plugin and is tested against it. ' +
          'System uses the claude on your PATH — it may be newer and self-updates, but is not ' +
          'version-matched to the plugin (advanced). Custom uses a specific path.',
        control: {
          kind: 'select',
          options: [
            { value: 'bundled', label: 'Bundled (recommended)' },
            { value: 'system', label: 'System (claude on PATH)' },
            { value: 'custom', label: 'Custom path' },
          ],
        },
        default: 'bundled',
      },
      {
        key: 'ai.claudeExecutablePath',
        title: 'Claude CLI Path',
        description:
          'Absolute path to the claude executable, used when Claude CLI is set to Custom.',
        control: { kind: 'text', placeholder: '/usr/local/bin/claude' },
        default: '',
      },
      {
        key: 'ai.codexExecutable',
        title: 'Codex CLI',
        description:
          'Which Codex the Codex agent runs. Bundled comes with the Codex plugin and is tested ' +
          'against it. System uses the codex on your PATH — it may be newer, but is not ' +
          'version-matched to the plugin (advanced). Custom uses a specific path. Either falls back ' +
          'to Bundled when the Codex it names is not found.',
        control: {
          kind: 'select',
          options: [
            { value: 'bundled', label: 'Bundled (recommended)' },
            { value: 'system', label: 'System (codex on PATH)' },
            { value: 'custom', label: 'Custom path' },
          ],
        },
        default: 'bundled',
      },
      {
        key: 'ai.codexExecutablePath',
        title: 'Codex CLI Path',
        description: 'Absolute path to the codex executable, used when Codex CLI is set to Custom.',
        control: { kind: 'text', placeholder: '/usr/local/bin/codex' },
        default: '',
      },
    ],
  },
  {
    id: 'mission-control',
    label: 'Mission Control',
    settings: [
      {
        key: 'missionControl.tileScrollMode',
        title: 'Agent Scroll Behaviour',
        description:
          'How clicking an agent in the list brings its column into view: the shortest scroll that reveals it, or aligning its left edge to the start of the row (which can leave trailing space at the end).',
        control: {
          kind: 'select',
          options: [
            { value: 'into-view', label: 'Scroll into view' },
            { value: 'absolute-left', label: 'Align to left' },
          ],
        },
        default: 'into-view',
      },
    ],
  },
  {
    id: 'system-monitor',
    label: 'System Monitor',
    settings: [
      {
        key: 'systemMonitor.refreshRate',
        title: 'Refresh Rate',
        description:
          'How often the System Monitor reads the machine while it is showing. A faster rate shows ' +
          'changes sooner and costs a little more to gather; Paused keeps the last readings on ' +
          'screen and reads nothing.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '500', label: 'High (twice a second)' },
            { value: '1000', label: 'Normal (every second)' },
            { value: '4000', label: 'Low (every 4 seconds)' },
            { value: '0', label: 'Paused' },
          ],
        },
        default: 1000,
      },
      {
        key: 'systemMonitor.logLevel',
        title: 'Log Level',
        description:
          'The least severe records Studio writes to its logs. Automatic keeps Info and above in ' +
          'a release build and everything in a development build. Choose Trace or Debug while ' +
          'investigating a problem, then set it back: those levels write many times more, so the ' +
          'rolling studio.log rotates sooner. The STUDIO_LOG_LEVEL environment variable overrides ' +
          'this for a launch.',
        control: {
          kind: 'select',
          options: [
            { value: 'auto', label: 'Automatic' },
            { value: 'trace', label: 'Trace' },
            { value: 'debug', label: 'Debug' },
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'error', label: 'Error' },
          ],
        },
        default: 'auto',
      },
    ],
  },
  {
    id: 'database-explorer',
    label: 'Database Explorer',
    settings: [
      {
        key: 'databaseExplorer.selectAction',
        title: 'Select Actions',
        description:
          'What happens when you choose an action that reads data from the Object Explorer, such as ' +
          'Select Top 1000 Rows or Match 25 Nodes. Open the query leaves it for you to run; Open and ' +
          'run the query runs it straight away. Actions that write a script, such as Script as ' +
          'CREATE, only ever open it.',
        control: {
          kind: 'select',
          options: [
            { value: 'open', label: 'Open the query' },
            { value: 'open-and-run', label: 'Open and run the query' },
          ],
        },
        default: 'open',
      },
      {
        key: 'databaseExplorer.gridlines',
        title: 'Results Gridlines',
        description:
          'The lines drawn between the cells of a results grid: none, a line under each row, or a ' +
          'full grid between rows and columns.',
        control: {
          kind: 'select',
          options: [
            { value: 'none', label: 'None' },
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'full', label: 'Horizontal and vertical' },
          ],
        },
        default: 'horizontal',
      },
      {
        key: 'databaseExplorer.gridlineTone',
        title: 'Results Gridline Colour',
        description:
          'How strongly the gridlines of a results grid are drawn: Light is a faint rule that stays ' +
          'out of the way of the data; Dark is a firm one that makes the grid easy to follow across a ' +
          'wide row.',
        control: {
          kind: 'select',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        },
        default: 'light',
      },
    ],
  },
  {
    id: 'plugins',
    label: 'Plugin Manager',
    settings: [
      {
        key: 'plugins.loadSideloaded',
        // Owned by the main process, which reads it at launch before any plugin is resolved (#979), so
        // it is never in the renderer's settings store. Always on, and locked, in the development app.
        owner: 'plugins',
        title: 'Load Sideloaded Plugins',
        description:
          "Load plugins placed in the plugins folder by hand. These skip Studio's integrity check " +
          'and can replace a plugin from the catalogue, so leave this off unless you put one there ' +
          'yourself. Takes effect after a restart.',
        control: { kind: 'toggle' },
        requiresRestart: true,
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    settings: [
      {
        key: 'security.imagePolicy',
        owner: 'security',
        title: 'Remote Images',
        description:
          'Which image sources content (such as markdown) may load. Restricting this reduces exposure to remote tracking and untrusted content.',
        control: {
          kind: 'select',
          options: [
            { value: 'local', label: 'Local only (safest)' },
            { value: 'https', label: 'HTTPS only (safe)' },
            { value: 'all', label: 'HTTP and HTTPS (less safe)' },
          ],
        },
      },
    ],
    footer: 'Changes to the content-security policy take effect the next time Studio starts.',
  },
];

/**
 * Holds a flattened lookup of every setting definition by key (across all owners).
 */
export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(
  SETTINGS_REGISTRY.flatMap((section: SectionDef): readonly [string, SettingDef][] =>
    section.settings.map((setting: SettingDef): [string, SettingDef] => [setting.key, setting]),
  ),
);

/**
 * Holds the default value for every Settings-owned setting key. Foreign-owned settings (Theme,
 * Display, LSP, Security, Plugins) are excluded — their values live in their own services.
 */
export const SETTINGS_DEFAULTS: SettingsValues = Object.fromEntries(
  [...SETTINGS_BY_KEY.values()]
    .filter(isSettingsOwned)
    .map((setting: SettingsOwnedDef): [SettingsKey, unknown] => [setting.key, setting.default]),
) as unknown as SettingsValues;

/**
 * The sections holding the code settings: code-wide behaviour, how code looks, and how it is edited.
 * They were one Text Editor section; the language pages override a subset of them.
 */
export const CODE_SECTION_IDS: readonly string[] = [
  'code-general',
  'code-appearance',
  'code-editing',
];

/**
 * Lists every code setting, across the sections that hold them.
 * @returns Returns the code settings, appearance first.
 */
export function codeSettings(): readonly SettingDef[] {
  return CODE_SECTION_IDS.flatMap(
    (id: string): readonly SettingDef[] => findSection(id)?.settings ?? [],
  );
}

/**
 * Returns the section with the given id, or undefined when it is unknown.
 * @param id The section identifier.
 * @returns Returns the section definition, or undefined.
 */
export function findSection(id: string): SectionDef | undefined {
  return SETTINGS_REGISTRY.find((section: SectionDef): boolean => section.id === id);
}
