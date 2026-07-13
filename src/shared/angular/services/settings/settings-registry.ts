import { Icon } from '@shared/angular/icons/icon';
import { ACCENT_COLORS } from '@shared/angular/services/theme/theme';
import type { AccentColor } from '@shared/angular/services/theme/theme';
import type { AiPermissionPosture, AiProviderId } from '@shared/api/ai-types';
import type {
  BraceStyle,
  CurrentLineHighlightStyle,
  CursorBlinkingStyle,
  CursorSmoothCaretAnimation,
  DefaultDocumentType,
  EditorProfile,
  FileExplorerExpandAll,
  ImageAlignment,
  ImageSizing,
  MarginSize,
  ModernUiFeatures,
  PrintMargin,
  RibbonAlignment,
} from './settings';
import { isSettingsOwned } from './settings-schema';
import type { ColorSwatch, SectionDef, SettingDef, SettingsOwnedDef } from './settings-schema';

/**
 * Defines the per-provider AI model selection map. A missing entry means "use the provider's default
 * model".
 */
export type AiModels = Readonly<Partial<Record<AiProviderId, string>>>;

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

  readonly 'application.defaultDocumentType': DefaultDocumentType;
  readonly 'application.undoStackSize': number;
  readonly 'application.showLauncherActions': boolean;
  readonly 'application.printMargin': PrintMargin;

  readonly 'workspaces.fileExplorerExpandAll': FileExplorerExpandAll;

  readonly 'textEditor.global.showLineNumbers': boolean;
  readonly 'textEditor.global.showMinimap': boolean;
  readonly 'textEditor.global.currentLineHighlight': CurrentLineHighlightStyle;
  readonly 'textEditor.global.colorBrackets': boolean;
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

  readonly 'terminal.defaultShell': string;

  readonly 'keyboard.overrides': Readonly<Record<string, string>>;

  readonly 'ai.provider': AiProviderId;
  readonly 'ai.models': AiModels;
  readonly 'ai.permissionPosture': AiPermissionPosture;
  readonly 'ai.tokenCap': number;
  readonly 'ai.runTimeoutMinutes': number;
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
        description: 'The colour used for highlights and focus.',
        control: {
          kind: 'color',
          swatches: ACCENT_COLORS.map(
            (color: AccentColor): ColorSwatch => ({
              value: color,
              color: `var(--accent-${color})`,
              label: color,
            }),
          ),
        },
      },
      {
        key: 'appearance.themeMode',
        owner: 'theme',
        title: 'Theme',
        description: 'Light, dark, or follow the operating system.',
        control: {
          kind: 'buttonGroup',
          options: [
            { value: 'light', label: 'Light', icon: Icon.THEME_LIGHT },
            { value: 'dark', label: 'Dark', icon: Icon.THEME_DARK },
            { value: 'system', label: 'System', icon: Icon.THEME_SYSTEM },
          ],
        },
      },
      {
        key: 'appearance.ribbonAlignment',
        title: 'Ribbon Alignment',
        description: "How the ribbon's controls are aligned within the ribbon strip.",
        control: {
          kind: 'buttonGroup',
          options: [
            { value: 'left', label: 'Left', icon: Icon.ALIGN_LEFT },
            { value: 'center', label: 'Center', icon: Icon.ALIGN_CENTER },
            { value: 'right', label: 'Right', icon: Icon.ALIGN_RIGHT },
          ],
        },
        default: 'left',
      },
      {
        key: 'appearance.modernUiFeatures',
        title: 'Modern UI Features',
        description: 'Squircle corners and richer visual effects.',
        control: {
          kind: 'buttonGroup',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
        default: 'auto',
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
        key: 'application.defaultDocumentType',
        title: 'Default document type',
        description: 'The document type created when you open a new tab.',
        control: {
          kind: 'select',
          options: [
            { value: 'code', label: 'Code' },
            { value: 'markdown', label: 'Markdown' },
          ],
        },
        default: 'code',
      },
      {
        key: 'application.undoStackSize',
        title: 'Undo history',
        description: 'Number of undo steps kept (10-1000).',
        control: { kind: 'number', min: 10, max: 1000, step: 1 },
        default: 100,
      },
      {
        key: 'application.showLauncherActions',
        title: 'Title bar quick actions',
        description:
          'Replace the welcome button in the title bar with buttons for opening files and creating new code, markdown, terminal, and agent tabs.',
        control: { kind: 'toggle' },
        default: false,
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
        key: 'textEditor.global.colorBrackets',
        title: 'Coloured brackets',
        description: 'Colour matching bracket pairs by their nesting depth.',
        control: { kind: 'toggle' },
        profileOverridable: true,
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
        key: 'textEditor.global.insertSpaces',
        title: 'Insert spaces',
        description: 'Insert spaces instead of tabs when indenting.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.tabSize',
        title: 'Tab size',
        description: 'The number of spaces a single indentation level occupies.',
        control: { kind: 'number', min: 1, max: 8, step: 1, unit: 'spaces' },
        profileOverridable: true,
        default: 2,
      },
      {
        key: 'textEditor.global.fontFamily',
        title: 'Font family',
        description: 'The editor font family.',
        control: { kind: 'text', placeholder: 'JetBrains Mono' },
        default: 'JetBrains Mono',
      },
      {
        key: 'textEditor.global.fontSize',
        title: 'Font size',
        description: 'The editor font size in pixels.',
        control: { kind: 'number', min: 6, max: 72, step: 1, unit: 'px' },
        default: 14,
      },
      {
        key: 'textEditor.global.lineHeight',
        title: 'Line height',
        description: 'The line height as a multiple of the font size; 0 derives it automatically.',
        control: { kind: 'number', min: 0, max: 4, step: 0.1 },
        profileOverridable: true,
        default: 0,
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
        control: { kind: 'text', placeholder: 'System Default' },
        default: 'System Default',
      },
      {
        key: 'markdownEditor.monospaceFontFamily',
        title: 'Monospace font',
        description: 'Font family used for code blocks.',
        control: { kind: 'text', placeholder: 'JetBrains Mono' },
        default: 'JetBrains Mono',
      },
      {
        key: 'markdownEditor.fontSize',
        title: 'Font size',
        description: 'Base font size in pixels.',
        control: { kind: 'number', min: 8, max: 48, step: 1, unit: 'px' },
        default: 16,
      },
      {
        key: 'markdownEditor.marginSize',
        title: 'Container width',
        description:
          'Maximum content width. Steps down to the next breakpoint when the editor is too narrow, and goes fluid below 1024px.',
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
        key: 'ai.provider',
        title: 'Provider',
        description: 'The AI provider used by the agent.',
        control: { kind: 'custom', component: 'ai-provider' },
        default: 'claude',
      },
      {
        key: 'ai.models',
        title: 'Models',
        description:
          "The selected model per provider. A missing entry uses the provider's default.",
        control: { kind: 'custom', component: 'ai-model-map' },
        default: {},
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
        key: 'ai.tokenCap',
        title: 'Token cap',
        description: 'The per-request token budget (0 for the provider default).',
        control: { kind: 'number', min: 0, max: 1_000_000, step: 1000, unit: 'tokens' },
        default: 0,
      },
      {
        key: 'ai.runTimeoutMinutes',
        title: 'Run time limit',
        description:
          'Aborts a run after this many minutes (0 for no limit). The clock pauses while the agent waits for your input.',
        control: { kind: 'number', min: 0, max: 120, step: 1, unit: 'minutes' },
        default: 10,
      },
    ],
  },
  {
    id: 'language-servers',
    label: 'Language Servers',
    settings: [
      {
        key: 'lsp.server.typescript.enabled',
        owner: 'lsp',
        title: 'TypeScript / JavaScript',
        description:
          'Diagnostics, completion, hover, and go-to-definition for TypeScript and JavaScript.',
        control: { kind: 'toggle' },
      },
      {
        key: 'lsp.server.typescript.args',
        owner: 'lsp',
        title: 'TypeScript / JavaScript arguments',
        description:
          'Extra command-line arguments appended when the server starts. Separate arguments with spaces.',
        control: { kind: 'text', placeholder: 'None' },
      },
      {
        key: 'lsp.server.java.enabled',
        owner: 'lsp',
        title: 'Java',
        description:
          'Eclipse JDT Language Server. Requires a Java 21+ runtime; downloaded on first use.',
        control: { kind: 'toggle' },
      },
      {
        key: 'lsp.server.java.args',
        owner: 'lsp',
        title: 'Java arguments',
        description:
          'Extra command-line arguments appended when the server starts. Separate arguments with spaces.',
        control: { kind: 'text', placeholder: 'None' },
      },
      {
        key: 'lsp.server.python.enabled',
        owner: 'lsp',
        title: 'Python',
        description: 'Pyright. Diagnostics, completion, hover, and go-to-definition for Python.',
        control: { kind: 'toggle' },
      },
      {
        key: 'lsp.server.python.args',
        owner: 'lsp',
        title: 'Python arguments',
        description:
          'Extra command-line arguments appended when the server starts. Separate arguments with spaces.',
        control: { kind: 'text', placeholder: 'None' },
      },
      {
        key: 'lsp.server.csharp.enabled',
        owner: 'lsp',
        title: 'C#',
        description:
          'Roslyn language server. Requires the .NET 10+ SDK; downloaded on first use. Build the project for full results.',
        control: { kind: 'toggle' },
      },
      {
        key: 'lsp.server.csharp.args',
        owner: 'lsp',
        title: 'C# arguments',
        description:
          'Extra command-line arguments appended when the server starts. Separate arguments with spaces.',
        control: { kind: 'text', placeholder: 'None' },
      },
      {
        key: 'lsp.server.clangd.enabled',
        owner: 'lsp',
        title: 'C / C++',
        description:
          'clangd. Requires LLVM or Xcode Command Line Tools. A compile_commands.json gives full results.',
        control: { kind: 'toggle' },
      },
      {
        key: 'lsp.server.clangd.args',
        owner: 'lsp',
        title: 'C / C++ arguments',
        description:
          'Extra command-line arguments appended when the server starts. Separate arguments with spaces.',
        control: { kind: 'text', placeholder: 'None' },
      },
      {
        key: 'lsp.path.typescriptServer',
        owner: 'lsp',
        title: 'TypeScript server path',
        description:
          'Path to a custom typescript-language-server CLI module (its JavaScript entry point). Leave empty to use the server bundled with Studio.',
        control: { kind: 'text', placeholder: 'Bundled' },
      },
      {
        key: 'lsp.path.java',
        owner: 'lsp',
        title: 'Java runtime',
        description:
          'Path to the Java 21+ executable used to run the Java language server. Leave empty to detect it from JAVA_HOME or the PATH.',
        control: { kind: 'text', placeholder: 'Auto-detect' },
      },
      {
        key: 'lsp.path.dotnet',
        owner: 'lsp',
        title: '.NET SDK',
        description:
          'Path to the dotnet executable used to install and run the C# language server. Leave empty to detect it from DOTNET_ROOT or the PATH.',
        control: { kind: 'text', placeholder: 'Auto-detect' },
      },
      {
        key: 'lsp.path.clangd',
        owner: 'lsp',
        title: 'clangd',
        description:
          'Path to the clangd executable used for C and C++. Leave empty to detect it from the PATH, Xcode Command Line Tools, or LLVM.',
        control: { kind: 'text', placeholder: 'Auto-detect' },
      },
    ],
    footer:
      'Changes apply to language servers started afterwards. Reopen a file or restart Studio to apply them.',
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
