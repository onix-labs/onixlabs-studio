import { Icon } from '../../icons/icon';
import { ACCENT_COLORS } from '../theme/theme';
import type { AccentColor } from '../theme/theme';
import type { AiPermissionPosture, AiProviderId } from '../../../shared/ai-types';
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
  PanelPosition,
  RibbonAlignment,
} from './settings';

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

  readonly 'workspaces.fileExplorerExpandAll': FileExplorerExpandAll;

  readonly 'textEditor.global.showLineNumbers': boolean;
  readonly 'textEditor.global.showMinimap': boolean;
  readonly 'textEditor.global.currentLineHighlight': CurrentLineHighlightStyle;
  readonly 'textEditor.global.wordWrap': boolean;
  readonly 'textEditor.global.stickyScroll': boolean;
  readonly 'textEditor.global.cursorBlinking': CursorBlinkingStyle;
  readonly 'textEditor.global.cursorSmoothCaretAnimation': CursorSmoothCaretAnimation;
  readonly 'textEditor.global.insertSpaces': boolean;
  readonly 'textEditor.global.tabSize': number;
  readonly 'textEditor.global.fontFamily': string;
  readonly 'textEditor.global.fontSize': number;
  readonly 'textEditor.global.braceStyle': BraceStyle;
  readonly 'textEditor.profiles': readonly EditorProfile[];

  readonly 'markdownEditor.fontFamily': string;
  readonly 'markdownEditor.monospaceFontFamily': string;
  readonly 'markdownEditor.fontSize': number;
  readonly 'markdownEditor.marginSize': MarginSize;
  readonly 'markdownEditor.imageSizing': ImageSizing;
  readonly 'markdownEditor.imageAlignment': ImageAlignment;
  readonly 'markdownEditor.panelPosition': PanelPosition;

  readonly 'ai.provider': AiProviderId;
  readonly 'ai.models': AiModels;
  readonly 'ai.permissionPosture': AiPermissionPosture;
  readonly 'ai.tokenCap': number;
}

/**
 * Identifies any setting by its stable key.
 */
export type SettingsKey = keyof SettingsValues;

/**
 * Defines a selectable option in a choice control (select or button group). The {@link value} is the
 * semantic value persisted and read by consumers; the {@link label} is presentation only.
 */
export interface ChoiceOption {
  /**
   * Gets the value applied when the option is selected.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets the optional icon shown before the label (button groups only).
   */
  readonly icon?: Icon;
}

/**
 * Defines a selectable swatch in a colour control. The {@link value} is the semantic value persisted
 * and read by consumers; {@link color} is the CSS colour the swatch displays.
 */
export interface ColorSwatch {
  /**
   * Gets the value applied when the swatch is selected.
   */
  readonly value: string;

  /**
   * Gets the CSS colour the swatch displays (for example a custom-property reference).
   */
  readonly color: string;

  /**
   * Gets the accessible label for the swatch.
   */
  readonly label: string;
}

/**
 * Describes the control used to render and edit a setting. The {@link ControlDef.kind} discriminates
 * the shape: each kind carries only the metadata that kind needs.
 *
 * `custom` is the escape hatch for structurally complex settings (per-language editor profiles, the
 * per-provider AI model map) that the generic renderer cannot model; those are rendered by the named
 * bespoke component instead.
 */
export type ControlDef =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'text'; readonly placeholder?: string }
  | {
      readonly kind: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly unit?: string;
    }
  | { readonly kind: 'select'; readonly options: readonly ChoiceOption[] }
  | { readonly kind: 'buttonGroup'; readonly options: readonly ChoiceOption[] }
  | { readonly kind: 'color'; readonly swatches: readonly ColorSwatch[] }
  | { readonly kind: 'custom'; readonly component: string };

/**
 * Identifies which service owns a setting's value. A setting owned by `settings` lives in the Settings
 * store; other owners (the Theme, Display, LSP and Security services) own their own state, and the
 * renderer binds to them through the {@link import('./setting-bindings').SettingBindings} resolver.
 */
export type SettingOwner = 'settings' | 'theme' | 'display' | 'lsp' | 'security';

/**
 * Identifies an owner other than the Settings service.
 */
export type ForeignOwner = Exclude<SettingOwner, 'settings'>;

/**
 * Holds the display and control fields shared by every setting definition.
 */
interface BaseSettingDef {
  /**
   * Gets the label shown for the setting.
   */
  readonly title: string;

  /**
   * Gets the description shown beneath the label.
   */
  readonly description: string;

  /**
   * Gets the control used to render and edit the setting.
   */
  readonly control: ControlDef;

  /**
   * Gets a value indicating whether this setting can be overridden by a per-language editor profile.
   * Used to drive the profile override editor from the registry.
   */
  readonly profileOverridable?: boolean;

  /**
   * Gets a value indicating whether changing this setting requires an application restart to take
   * effect. The settings view aggregates these into a single "restart required" banner; the setting's
   * binding reports when a change is actually pending (see `SettingBinding.restartPending`).
   */
  readonly requiresRestart?: boolean;
}

/**
 * Describes a setting owned by the Settings store. Its key is checked against {@link SettingsValues},
 * and it carries the default applied when no override is persisted.
 */
export interface SettingsOwnedDef extends BaseSettingDef {
  /**
   * Gets the owner of the value (the Settings store).
   */
  readonly owner?: 'settings';

  /**
   * Gets the stable, namespaced lookup key (for example `application.undoStackSize`).
   */
  readonly key: SettingsKey;

  /**
   * Gets the default value applied when no user override is persisted.
   */
  readonly default: unknown;
}

/**
 * Describes a setting owned by another service (Theme, Display, LSP or Security). Its value lives in
 * that service, so it has no Settings-store default; the renderer reads and writes it through the
 * binding resolver.
 */
export interface ForeignSettingDef extends BaseSettingDef {
  /**
   * Gets the owner of the value.
   */
  readonly owner: ForeignOwner;

  /**
   * Gets the stable, namespaced lookup key (for example `security.imagePolicy`).
   */
  readonly key: string;
}

/**
 * Describes a single setting: its stable key, the display text, the control used to edit it, and the
 * service that owns its value. Defaults are the actual value (never an index), so reordering a
 * control's options can never corrupt persisted state.
 */
export type SettingDef = SettingsOwnedDef | ForeignSettingDef;

/**
 * Describes a settings section: a titled group of settings.
 */
export interface SectionDef {
  /**
   * Gets the identifier of the section, matching the settings navigation.
   */
  readonly id: string;

  /**
   * Gets the label shown for the section.
   */
  readonly label: string;

  /**
   * Gets the settings in the section, in display order.
   */
  readonly settings: readonly SettingDef[];

  /**
   * Gets the optional hint shown beneath the section's settings.
   */
  readonly footer?: string;
}

/**
 * Determines whether a setting is owned by the Settings store.
 * @param def The setting definition.
 * @returns Returns true when the setting is Settings-owned.
 */
export function isSettingsOwned(def: SettingDef): def is SettingsOwnedDef {
  return def.owner === undefined || def.owner === 'settings';
}

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
      {
        key: 'markdownEditor.panelPosition',
        title: 'Panel position',
        description:
          'Which side of the editor the tool panels (Outline, Review, Agent, Reader) are shown on.',
        control: {
          kind: 'select',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ],
        },
        default: 'right',
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
        description: "The selected model per provider. A missing entry uses the provider's default.",
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
