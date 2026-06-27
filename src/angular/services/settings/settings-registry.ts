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
  | { readonly kind: 'color'; readonly swatches?: readonly string[] }
  | { readonly kind: 'custom'; readonly component: string };

/**
 * Describes a single setting: its stable key, the display text, the control used to edit it, and its
 * default value. The default is the actual value (never an index), so reordering a control's options
 * can never corrupt persisted state.
 */
export interface SettingDef {
  /**
   * Gets the stable, namespaced lookup key (for example `application.undoStackSize`).
   */
  readonly key: SettingsKey;

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
   * Gets the default value applied when no user override is persisted.
   */
  readonly default: unknown;
}

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
        key: 'appearance.ribbonAlignment',
        title: 'Ribbon Alignment',
        description: "How the ribbon's controls are aligned within the ribbon strip.",
        control: {
          kind: 'buttonGroup',
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
          kind: 'buttonGroup',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
        default: 'auto',
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
        default: true,
      },
      {
        key: 'textEditor.global.showMinimap',
        title: 'Minimap',
        description: 'Show the minimap.',
        control: { kind: 'toggle' },
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
        default: false,
      },
      {
        key: 'textEditor.global.stickyScroll',
        title: 'Sticky scroll',
        description: 'Pin scope context to the top while scrolling.',
        control: { kind: 'toggle' },
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
        default: true,
      },
      {
        key: 'textEditor.global.tabSize',
        title: 'Tab size',
        description: 'The number of spaces a single indentation level occupies.',
        control: { kind: 'number', min: 1, max: 8, step: 1, unit: 'spaces' },
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
        control: { kind: 'custom', component: 'ai-permission-posture' },
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
];

/**
 * Holds a flattened lookup of every setting definition by key.
 */
export const SETTINGS_BY_KEY: ReadonlyMap<SettingsKey, SettingDef> = new Map(
  SETTINGS_REGISTRY.flatMap((section: SectionDef): readonly [SettingsKey, SettingDef][] =>
    section.settings.map((setting: SettingDef): [SettingsKey, SettingDef] => [setting.key, setting]),
  ),
);

/**
 * Holds the default value for every setting key.
 */
export const SETTINGS_DEFAULTS: SettingsValues = Object.fromEntries(
  [...SETTINGS_BY_KEY].map(([key, setting]: [SettingsKey, SettingDef]): [SettingsKey, unknown] => [
    key,
    setting.default,
  ]),
) as unknown as SettingsValues;

/**
 * Returns the settings in a section, in display order, or an empty list when the section is unknown.
 * @param id The section identifier.
 * @returns Returns the section's settings.
 */
export function sectionSettings(id: string): readonly SettingDef[] {
  return SETTINGS_REGISTRY.find((section: SectionDef): boolean => section.id === id)?.settings ?? [];
}
