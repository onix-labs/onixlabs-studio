import type {
  AiConnection,
  AiPermissionPosture,
  AiRemoteControlPosture,
  AiToolPolicy,
  ClaudeExecutableMode,
} from '@shared/api/ai-types';
import { DEFAULT_CONNECTION_ID, SEED_CONNECTIONS } from '@shared/api/ai-types';
import type {
  ApplicationMenuAppearance,
  ApplicationMenuMode,
  BraceStyle,
  CurrentLineHighlightStyle,
  CursorBlinkingStyle,
  CursorSmoothCaretAnimation,
  EditorProfile,
  FileExplorerExpandAll,
  ImageAlignment,
  ImageSizing,
  MarginSize,
  ModernUiFeatures,
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
 * Maps every setting key to the type of value it holds. This is the type-safe contract consumers read
 * through {@link import('./settings').Settings.get}; the runtime {@link SETTINGS_REGISTRY} is checked
 * against these keys, so a registry entry whose key is not declared here is a compile error.
 *
 * Adding a setting is two co-located edits: one entry in the registry and one line here.
 */
export interface SettingsValues {
  readonly 'appearance.ribbonAlignment': RibbonAlignment;
  readonly 'appearance.modernUiFeatures': ModernUiFeatures;
  readonly 'appearance.workspaceTexture': WorkspaceTexture;

  readonly 'application.undoStackSize': number;
  readonly 'application.printMargin': PrintMargin;
  readonly 'application.menuMode': ApplicationMenuMode;
  readonly 'application.menuAppearance': ApplicationMenuAppearance;
  readonly 'application.showWindowLock': boolean;

  readonly 'accessibility.showTooltips': boolean;

  readonly 'notifications.toastDuration': number;
  readonly 'notifications.agentRequestToasts': boolean;

  readonly 'workspaces.fileExplorerExpandAll': FileExplorerExpandAll;

  readonly 'textEditor.global.showLineNumbers': boolean;
  readonly 'textEditor.global.showMinimap': boolean;
  readonly 'textEditor.global.currentLineHighlight': CurrentLineHighlightStyle;
  readonly 'textEditor.global.colorBrackets': boolean;
  readonly 'textEditor.global.accentSelection': boolean;
  readonly 'textEditor.global.wordWrap': boolean;
  readonly 'textEditor.global.stickyScroll': boolean;
  readonly 'textEditor.global.cursorBlinking': CursorBlinkingStyle;
  readonly 'textEditor.global.cursorSmoothCaretAnimation': CursorSmoothCaretAnimation;
  readonly 'textEditor.global.insertSpaces': boolean;
  readonly 'textEditor.global.tabSize': number;
  readonly 'textEditor.global.fontFamily': string;
  readonly 'textEditor.global.fontSize': number;
  readonly 'textEditor.global.lineHeight': number;
  readonly 'textEditor.global.braceStyle': BraceStyle;
  readonly 'textEditor.profiles': readonly EditorProfile[];

  readonly 'markdownEditor.fontFamily': string;
  readonly 'markdownEditor.monospaceFontFamily': string;
  readonly 'markdownEditor.fontSize': number;
  readonly 'markdownEditor.marginSize': MarginSize;
  readonly 'markdownEditor.imageSizing': ImageSizing;
  readonly 'markdownEditor.imageAlignment': ImageAlignment;
  readonly 'markdownEditor.selectAllScope': SelectAllScope;

  readonly 'terminal.defaultShell': string;

  readonly 'keyboard.overrides': Readonly<Record<string, string>>;

  readonly 'ai.connections': readonly AiConnection[];
  readonly 'ai.activeConnectionId': string;
  readonly 'ai.connectionModels': AiConnectionModels;
  readonly 'ai.autoScroll': boolean;
  readonly 'ai.reportBackgroundTasks': boolean;
  readonly 'ai.permissionPosture': AiPermissionPosture;
  readonly 'ai.remoteControlPosture': AiRemoteControlPosture;
  readonly 'ai.toolPolicies': Readonly<Record<string, AiToolPolicy>>;
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

  readonly 'missionControl.tileScrollMode': TileScrollMode;
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
    id: 'appearance',
    label: 'Appearance',
    settings: [
      {
        key: 'appearance.accent',
        owner: 'theme',
        title: 'Accent',
        description:
          'The colour used for highlights and focus. Pick a preset, or choose Custom for any hue.',
        control: { kind: 'accent' },
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
        key: 'appearance.ribbonAlignment',
        title: 'Ribbon Alignment',
        description: "How the ribbon's controls are aligned within the ribbon strip.",
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
        key: 'appearance.modernUiFeatures',
        title: 'Modern UI Features',
        description: 'Squircle corners and richer visual effects.',
        control: {
          kind: 'select',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
        default: 'auto',
      },
      {
        key: 'appearance.workspaceTexture',
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
      {
        key: 'display.hardwareAcceleration',
        owner: 'display',
        title: 'Hardware Acceleration',
        description:
          'Use the GPU to render the interface. Turning this off can fix rendering glitches on some graphics hardware, but may reduce smoothness. Changing it restarts the application.',
        control: { kind: 'toggle' },
        requiresRestart: true,
      },
    ],
  },
  {
    id: 'application',
    label: 'Application',
    settings: [
      {
        key: 'application.menuMode',
        title: 'Application menu',
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
        title: 'Application menu appearance',
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
        key: 'application.showWindowLock',
        title: 'Window lock switch',
        description:
          'Carry the switch at the start of the title strip that pins the window in place, so ' +
          'dragging the strip no longer moves it. Turning this off releases the lock as well as ' +
          'hiding the switch: the strip is the only place the lock can be released, so a window ' +
          'left locked without it could never be moved again.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'application.undoStackSize',
        title: 'Undo history',
        description: 'Number of undo steps kept.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '25', label: '25' },
            { value: '50', label: '50' },
            { value: '75', label: '75' },
            { value: '100', label: '100' },
            { value: '150', label: '150' },
            { value: '200', label: '200' },
          ],
        },
        default: 100,
      },
      {
        key: 'application.printMargin',
        title: 'Print margins',
        description:
          'The page margin applied when printing or exporting a document to PDF. Regular is double Narrow, and Wide is double Regular.',
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
    id: 'accessibility',
    label: 'Accessibility',
    settings: [
      {
        key: 'accessibility.showTooltips',
        title: 'Tooltips on icon-only controls',
        description:
          'Name a control that shows only an icon, in a tooltip below it, on hover or keyboard ' +
          'focus. These controls always carry their name for a screen reader; this shows the same ' +
          'name to everyone else. Controls with visible text are unaffected.',
        control: { kind: 'toggle' },
        default: true,
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    settings: [
      {
        key: 'notifications.toastDuration',
        title: 'Toast duration',
        description:
          'How long a transient notification toast stays on screen. Hovering a toast pauses its ' +
          'timer, and error toasts always stay until dismissed.',
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
        title: 'Agent requests as toasts',
        description:
          'Raise a toast when an agent in a background tab asks a question or requests permission. ' +
          'Answering stays in the conversation; the toast jumps to the asking tab.',
        control: { kind: 'toggle' },
        default: false,
      },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    settings: [
      {
        key: 'workspaces.fileExplorerExpandAll',
        title: 'Expand All scope',
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
    ],
  },
  {
    id: 'text-editor',
    label: 'Text Editor',
    settings: [
      {
        key: 'textEditor.global.fontFamily',
        title: 'Font family',
        description: 'The editor font family.',
        control: {
          kind: 'select',
          options: [{ value: 'JetBrains Mono', label: 'JetBrains Mono' }],
        },
        default: 'JetBrains Mono',
      },
      {
        key: 'textEditor.global.fontSize',
        title: 'Font size',
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
        title: 'Line height',
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
        profileOverridable: true,
        default: 0,
      },
      {
        key: 'textEditor.global.tabSize',
        title: 'Tab size',
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
        key: 'textEditor.global.currentLineHighlight',
        title: 'Current line highlight',
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
        key: 'textEditor.global.braceStyle',
        title: 'Brace style',
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
        key: 'textEditor.global.cursorBlinking',
        title: 'Cursor blinking',
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
        title: 'Smooth caret animation',
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
        title: 'Line numbers',
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
        title: 'Coloured brackets',
        description: 'Colour matching bracket pairs by their nesting depth.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.accentSelection',
        title: 'Accent selection',
        description:
          'Use the accent colour for selected text in the editor (off uses the default).',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.wordWrap',
        title: 'Word wrap',
        description: 'Wrap long lines.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        key: 'textEditor.global.stickyScroll',
        title: 'Sticky scroll',
        description: 'Pin scope context to the top while scrolling.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.insertSpaces',
        title: 'Insert spaces',
        description: 'Insert spaces instead of tabs when indenting.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.profiles',
        title: 'Language profiles',
        description: 'Per-language overrides of the global editor settings.',
        control: { kind: 'custom', component: 'editor-profiles' },
        default: [],
      },
    ],
  },
  {
    id: 'markdown',
    label: 'Markdown',
    settings: [
      {
        key: 'markdownEditor.fontFamily',
        title: 'Body font',
        description: 'Font family used for body text.',
        control: {
          kind: 'select',
          options: [{ value: 'System Default', label: 'System Default' }],
        },
        default: 'System Default',
      },
      {
        key: 'markdownEditor.monospaceFontFamily',
        title: 'Monospace font',
        description: 'Font family used for code blocks.',
        control: {
          kind: 'select',
          options: [{ value: 'JetBrains Mono', label: 'JetBrains Mono' }],
        },
        default: 'JetBrains Mono',
      },
      {
        key: 'markdownEditor.fontSize',
        title: 'Font size',
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
        title: 'Container width',
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
        title: 'Image sizing',
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
        title: 'Image alignment',
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
        title: 'Select all (Cmd/Ctrl+A)',
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
    ],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    settings: [
      {
        key: 'terminal.defaultShell',
        title: 'Default shell',
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
        title: 'Active connection',
        description: 'The connection the agent runs turns through.',
        control: { kind: 'custom', component: 'ai-connections' },
        default: DEFAULT_CONNECTION_ID,
      },
      {
        key: 'ai.connectionModels',
        title: 'Selected models',
        description:
          "The model last selected per connection. A missing entry uses the connection's default.",
        control: { kind: 'custom', component: 'ai-connections' },
        default: {},
      },
      {
        key: 'ai.autoScroll',
        title: 'Auto-scroll transcripts',
        description:
          'Keep agent conversations pinned to the newest message as the response streams. Scrolling ' +
          'up pauses the follow; scrolling back to the bottom resumes it. Applies to every agent view.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'ai.reportBackgroundTasks',
        title: 'Report background tasks back',
        description:
          'When a task the agent backgrounded finishes, let the agent pick the conversation back up ' +
          'and tell you what it found, rather than only noting that it finished. The agent resumes on ' +
          'its own and spends tokens to do it, so turn this off to keep an idle conversation idle.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'ai.permissionPosture',
        title: 'Permission posture',
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
        title: 'Remote control posture',
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
        title: 'Tool permissions',
        description:
          'Default allow/ask/deny per tool. Deny blocks a tool even when the posture would ' +
          'auto-allow it; Allow skips the prompt; Ask uses the posture above.',
        control: { kind: 'custom', component: 'ai-tool-policies' },
        default: {},
      },
      {
        key: 'ai.allowedWritePaths',
        title: 'Allowed write paths',
        description:
          'Extra directories the agent may write to beyond the workspace root (absolute paths).',
        control: { kind: 'custom', component: 'ai-write-paths' },
        default: [],
      },
      {
        key: 'ai.deniedWritePaths',
        title: 'Denied write paths',
        description:
          'Paths the agent may never write to, even inside the workspace: an absolute path, or a ' +
          'name matched anywhere in the path (e.g. .git, .env).',
        control: { kind: 'custom', component: 'ai-write-paths' },
        default: [],
      },
      {
        key: 'ai.allowedNetworkLocations',
        title: 'Allowed network locations',
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
        title: 'Denied network locations',
        description:
          'Hosts the agent may never reach, even when the allowed list would permit them.',
        control: { kind: 'custom', component: 'ai-network-locations' },
        default: [],
      },
      {
        key: 'ai.tokenCap',
        title: 'Token cap',
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
        title: 'Run time limit',
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
        title: 'Keep agent sessions alive for',
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
        title: 'Agent shell',
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
          'discovering models. Bundled ships with Studio and is tested against it. System uses the ' +
          'claude on your PATH — it may be newer and self-updates, but is not version-matched to ' +
          'Studio (advanced). Custom uses a specific path.',
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
        title: 'Claude CLI path',
        description:
          'Absolute path to the claude executable, used when Claude CLI is set to Custom.',
        control: { kind: 'text', placeholder: '/usr/local/bin/claude' },
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
        title: 'Agent scroll behaviour',
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
    id: 'security',
    label: 'Security',
    settings: [
      {
        key: 'security.imagePolicy',
        owner: 'security',
        title: 'Remote images',
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
 * Display, LSP, Security) are excluded — their values live in their own services.
 */
export const SETTINGS_DEFAULTS: SettingsValues = Object.fromEntries(
  [...SETTINGS_BY_KEY.values()]
    .filter(isSettingsOwned)
    .map((setting: SettingsOwnedDef): [SettingsKey, unknown] => [setting.key, setting.default]),
) as unknown as SettingsValues;

/**
 * Returns the section with the given id, or undefined when it is unknown.
 * @param id The section identifier.
 * @returns Returns the section definition, or undefined.
 */
export function findSection(id: string): SectionDef | undefined {
  return SETTINGS_REGISTRY.find((section: SectionDef): boolean => section.id === id);
}
