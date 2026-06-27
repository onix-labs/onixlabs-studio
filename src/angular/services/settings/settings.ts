import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiPermissionPosture, AiProviderId } from '../../../shared/ai-types';
import {
  AiModels,
  SETTINGS_BY_KEY,
  SETTINGS_DEFAULTS,
  SettingDef,
  SettingsKey,
  SettingsValues,
} from './settings-registry';
import { SettingsStore } from '../settings-store/settings-store';

/**
 * Identifies the highlight style applied to the current line in the text editor.
 */
export type CurrentLineHighlightStyle = 'outline' | 'filled';

/**
 * Identifies the text editor cursor blinking animation style.
 */
export type CursorBlinkingStyle = 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';

/**
 * Identifies how the text editor cursor animates as it moves between positions.
 */
export type CursorSmoothCaretAnimation = 'off' | 'on' | 'explicit';

/**
 * Identifies the brace placement style the editor formats to: `kr` (K&R, opening brace on the same
 * line), `allman` (opening brace on its own line), or `gnu` (opening brace on its own line, indented).
 */
export type BraceStyle = 'kr' | 'allman' | 'gnu';

/**
 * Identifies the document margin size for the markdown editor.
 */
export type MarginSize = 'narrow' | 'medium' | 'wide' | 'full-width';

/**
 * Identifies how images are sized in the markdown editor.
 */
export type ImageSizing = 'fixed' | 'sizable';

/**
 * Identifies how images are horizontally aligned in the markdown editor.
 */
export type ImageAlignment = 'left' | 'center' | 'right';

/**
 * Identifies which side of the markdown editor the tool panels are shown on.
 */
export type PanelPosition = 'left' | 'right';

/**
 * Identifies the document type created by default for new documents.
 */
export type DefaultDocumentType = 'code' | 'markdown';

/**
 * Identifies how the ribbon's controls are aligned within the ribbon strip.
 */
export type RibbonAlignment = 'left' | 'center' | 'right';

/**
 * Identifies whether the modern UI features (GPU-rasterized squircle corners and the heavier
 * decorative effects) are used. `auto` follows the GPU-derived recommendation resolved at startup;
 * `on` and `off` are explicit user overrides.
 */
export type ModernUiFeatures = 'auto' | 'on' | 'off';

/**
 * Identifies how the File Explorer's "Expand All" behaves: `loaded-only` expands every directory whose
 * contents are already loaded; `entire-tree` reads and expands the whole tree from disk.
 */
export type FileExplorerExpandAll = 'loaded-only' | 'entire-tree';

/**
 * Defines the global text editor settings.
 */
export interface TextEditorSettings {
  /**
   * Gets a value indicating whether line numbers are shown.
   */
  readonly showLineNumbers: boolean;

  /**
   * Gets a value indicating whether the minimap is shown.
   */
  readonly showMinimap: boolean;

  /**
   * Gets the highlight style applied to the current line.
   */
  readonly currentLineHighlight: CurrentLineHighlightStyle;

  /**
   * Gets a value indicating whether long lines are wrapped.
   */
  readonly wordWrap: boolean;

  /**
   * Gets a value indicating whether sticky scroll (pinned scope context) is shown.
   */
  readonly stickyScroll: boolean;

  /**
   * Gets the cursor blinking animation style.
   */
  readonly cursorBlinking: CursorBlinkingStyle;

  /**
   * Gets how the cursor animates as it moves between positions.
   */
  readonly cursorSmoothCaretAnimation: CursorSmoothCaretAnimation;

  /**
   * Gets a value indicating whether indentation inserts spaces instead of tabs.
   */
  readonly insertSpaces: boolean;

  /**
   * Gets the number of spaces a single indentation level occupies.
   */
  readonly tabSize: number;

  /**
   * Gets the editor font family.
   */
  readonly fontFamily: string;

  /**
   * Gets the editor font size, in pixels.
   */
  readonly fontSize: number;

  /**
   * Gets the brace placement style the editor formats to.
   */
  readonly braceStyle: BraceStyle;
}

/**
 * Defines a partial set of text editor settings, used for per-language profile overrides.
 */
export type PartialTextEditorSettings = Partial<TextEditorSettings>;

/**
 * Defines a language-specific editor profile whose settings override the global defaults.
 */
export interface EditorProfile {
  /**
   * Gets the unique identifier of the profile.
   */
  readonly id: string;

  /**
   * Gets the display name of the profile.
   */
  readonly name: string;

  /**
   * Gets the Monaco language identifiers this profile applies to.
   */
  readonly languages: readonly string[];

  /**
   * Gets the settings overrides applied by this profile.
   */
  readonly settings: PartialTextEditorSettings;
}

/**
 * Defines the text editor settings together with their language-specific profiles.
 */
export interface TextEditorSettingsWithProfiles {
  /**
   * Gets the global default text editor settings.
   */
  readonly global: TextEditorSettings;

  /**
   * Gets the user-created editor profiles.
   */
  readonly profiles: readonly EditorProfile[];
}

/**
 * Defines the application-level settings.
 */
export interface ApplicationSettings {
  /**
   * Gets the document type created by default for new documents.
   */
  readonly defaultDocumentType: DefaultDocumentType;

  /**
   * Gets the maximum number of undo steps kept in history. Clamped to 10-1000.
   */
  readonly undoStackSize: number;

  /**
   * Gets a value indicating whether the title strip shows the quick-action launcher buttons (open,
   * new code/markdown/terminal/agent) in place of the single welcome button.
   */
  readonly showLauncherActions: boolean;
}

/**
 * Defines the appearance settings.
 */
export interface AppearanceSettings {
  /**
   * Gets the alignment of the ribbon's controls within the ribbon strip.
   */
  readonly ribbonAlignment: RibbonAlignment;

  /**
   * Gets whether the modern UI features (squircle corners and the heavier decorative effects) are
   * used, or whether the choice follows the GPU-derived recommendation.
   */
  readonly modernUiFeatures: ModernUiFeatures;
}

/**
 * Defines the markdown editor settings.
 */
export interface MarkdownEditorSettings {
  /**
   * Gets the body-text font family.
   */
  readonly fontFamily: string;

  /**
   * Gets the font family used for code blocks.
   */
  readonly monospaceFontFamily: string;

  /**
   * Gets the base font size, in pixels.
   */
  readonly fontSize: number;

  /**
   * Gets the document margin size.
   */
  readonly marginSize: MarginSize;

  /**
   * Gets the image sizing behaviour.
   */
  readonly imageSizing: ImageSizing;

  /**
   * Gets the horizontal alignment applied to images.
   */
  readonly imageAlignment: ImageAlignment;

  /**
   * Gets which side of the editor the tool panels (Outline, Review, Agent, Reader) are shown on.
   */
  readonly panelPosition: PanelPosition;
}

/**
 * Defines the AI agent settings. Provider and per-provider model selection are persisted here so the
 * agent restores the user's choice across sessions; the agent reads and writes them through this
 * service rather than holding its own in-memory selection.
 */
export interface AiSettings {
  /**
   * Gets the selected provider.
   */
  readonly provider: AiProviderId;

  /**
   * Gets the selected model per provider, keyed by provider id. A missing entry means "use the
   * provider's default model".
   */
  readonly models: AiModels;

  /**
   * Gets how much the agent may do without asking the user first.
   */
  readonly permissionPosture: AiPermissionPosture;

  /**
   * Gets the per-request token budget, or 0 for the provider default (no cap).
   */
  readonly tokenCap: number;
}

/**
 * Defines the workspace-level settings (the File Explorer and directory tree).
 */
export interface WorkspacesSettings {
  /**
   * Gets how the File Explorer's "Expand All" behaves.
   */
  readonly fileExplorerExpandAll: FileExplorerExpandAll;
}

/**
 * Defines the complete set of application settings owned by this service. Theme mode and accent are
 * intentionally excluded; they are owned by the Theme service.
 */
export interface AppSettings {
  /**
   * Gets the application-level settings.
   */
  readonly application: ApplicationSettings;

  /**
   * Gets the appearance settings.
   */
  readonly appearance: AppearanceSettings;

  /**
   * Gets the text editor settings with profiles.
   */
  readonly textEditor: TextEditorSettingsWithProfiles;

  /**
   * Gets the markdown editor settings.
   */
  readonly markdownEditor: MarkdownEditorSettings;

  /**
   * Gets the AI agent settings.
   */
  readonly ai: AiSettings;

  /**
   * Gets the workspace settings.
   */
  readonly workspaces: WorkspacesSettings;
}

/**
 * Defines the legacy text editor settings format (a flat object without profiles), retained so
 * settings persisted by an earlier version can be migrated forward.
 */
type LegacyTextEditorSettings = Partial<TextEditorSettings>;

/**
 * Defines the legacy persisted settings shape (nested section objects) accepted by the migration path.
 * The current format is a flat map keyed by the dotted setting keys.
 */
interface LegacyAppSettings {
  /**
   * Gets the persisted application settings, if any.
   */
  readonly application?: Partial<ApplicationSettings>;

  /**
   * Gets the persisted appearance settings, if any.
   */
  readonly appearance?: Partial<AppearanceSettings>;

  /**
   * Gets the persisted text editor settings, in either the legacy flat or the profile-aware format.
   */
  readonly textEditor?: LegacyTextEditorSettings | TextEditorSettingsWithProfiles;

  /**
   * Gets the persisted markdown editor settings, if any.
   */
  readonly markdownEditor?: Partial<MarkdownEditorSettings>;

  /**
   * Gets the persisted AI agent settings, if any.
   */
  readonly ai?: Partial<AiSettings>;

  /**
   * Gets the persisted workspace settings, if any.
   */
  readonly workspaces?: Partial<WorkspacesSettings>;
}

/**
 * Defines the persisted, sparse override map: only keys the user has changed from their default are
 * stored. Any absent key falls back to the registry default.
 */
type SettingsOverrides = Partial<Record<SettingsKey, unknown>>;

/**
 * Holds the settings-store key under which the settings are persisted.
 */
const SETTINGS_KEY: string = 'settings';

/**
 * Represents the source of truth for application, editor, markdown, AI and workspace settings.
 *
 * State is a sparse map of user overrides keyed by the registry's stable setting keys; any unset key
 * resolves to the registry default. The map is restored from the {@link SettingsStore} on construction
 * (migrating the legacy nested format forward), exposed through typed accessors, and auto-persisted by
 * an effect whenever it changes.
 *
 * New scalar settings are added by a single entry in the settings registry — the generic
 * {@link Settings.get} / {@link Settings.set} accessors and the generic renderer pick them up with no
 * further wiring. The named accessors below are thin, backwards-compatible wrappers retained so
 * existing consumers keep working.
 */
@Service()
export class Settings {
  /**
   * Holds the settings store used to persist and restore settings.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the current sparse override map.
   */
  private readonly overrides: WritableSignal<SettingsOverrides> = signal<SettingsOverrides>(
    this.load(),
  );

  /**
   * Holds the memoised per-key reactive value signals.
   */
  private readonly valueSignals: Map<SettingsKey, Signal<unknown>> = new Map<
    SettingsKey,
    Signal<unknown>
  >();

  /**
   * Gets the complete settings, assembled from the registry-backed overrides.
   */
  public readonly settings: Signal<AppSettings> = computed(
    (): AppSettings => ({
      application: this.application(),
      appearance: this.appearance(),
      textEditor: this.textEditor(),
      markdownEditor: this.markdownEditor(),
      ai: this.ai(),
      workspaces: this.workspaces(),
    }),
  );

  /**
   * Gets the application-level settings.
   */
  public readonly application: Signal<ApplicationSettings> = computed(
    (): ApplicationSettings => ({
      defaultDocumentType: this.read('application.defaultDocumentType'),
      undoStackSize: this.read('application.undoStackSize'),
      showLauncherActions: this.read('application.showLauncherActions'),
    }),
  );

  /**
   * Gets the appearance settings.
   */
  public readonly appearance: Signal<AppearanceSettings> = computed(
    (): AppearanceSettings => ({
      ribbonAlignment: this.read('appearance.ribbonAlignment'),
      modernUiFeatures: this.read('appearance.modernUiFeatures'),
    }),
  );

  /**
   * Gets the alignment of the ribbon's controls within the ribbon strip.
   */
  public readonly ribbonAlignment: Signal<RibbonAlignment> = this.value('appearance.ribbonAlignment');

  /**
   * Gets whether the modern UI features are used, or whether the choice follows the GPU-derived
   * recommendation.
   */
  public readonly modernUiFeatures: Signal<ModernUiFeatures> = this.value('appearance.modernUiFeatures');

  /**
   * Gets the default document type for new documents.
   */
  public readonly defaultDocumentType: Signal<DefaultDocumentType> = this.value(
    'application.defaultDocumentType',
  );

  /**
   * Gets the undo stack size.
   */
  public readonly undoStackSize: Signal<number> = this.value('application.undoStackSize');

  /**
   * Gets a value indicating whether the title strip shows the quick-action launcher buttons in place
   * of the single welcome button.
   */
  public readonly showLauncherActions: Signal<boolean> = this.value('application.showLauncherActions');

  /**
   * Gets the text editor settings with profiles.
   */
  public readonly textEditor: Signal<TextEditorSettingsWithProfiles> = computed(
    (): TextEditorSettingsWithProfiles => ({
      global: this.globalTextEditor(),
      profiles: this.profiles(),
    }),
  );

  /**
   * Gets the global text editor settings.
   */
  public readonly globalTextEditor: Signal<TextEditorSettings> = computed(
    (): TextEditorSettings => ({
      showLineNumbers: this.read('textEditor.global.showLineNumbers'),
      showMinimap: this.read('textEditor.global.showMinimap'),
      currentLineHighlight: this.read('textEditor.global.currentLineHighlight'),
      wordWrap: this.read('textEditor.global.wordWrap'),
      stickyScroll: this.read('textEditor.global.stickyScroll'),
      cursorBlinking: this.read('textEditor.global.cursorBlinking'),
      cursorSmoothCaretAnimation: this.read('textEditor.global.cursorSmoothCaretAnimation'),
      insertSpaces: this.read('textEditor.global.insertSpaces'),
      tabSize: this.read('textEditor.global.tabSize'),
      fontFamily: this.read('textEditor.global.fontFamily'),
      fontSize: this.read('textEditor.global.fontSize'),
      braceStyle: this.read('textEditor.global.braceStyle'),
    }),
  );

  /**
   * Gets the editor profiles.
   */
  public readonly profiles: Signal<readonly EditorProfile[]> = this.value('textEditor.profiles');

  /**
   * Gets the markdown editor settings.
   */
  public readonly markdownEditor: Signal<MarkdownEditorSettings> = computed(
    (): MarkdownEditorSettings => ({
      fontFamily: this.read('markdownEditor.fontFamily'),
      monospaceFontFamily: this.read('markdownEditor.monospaceFontFamily'),
      fontSize: this.read('markdownEditor.fontSize'),
      marginSize: this.read('markdownEditor.marginSize'),
      imageSizing: this.read('markdownEditor.imageSizing'),
      imageAlignment: this.read('markdownEditor.imageAlignment'),
      panelPosition: this.read('markdownEditor.panelPosition'),
    }),
  );

  /**
   * Gets the workspace settings.
   */
  public readonly workspaces: Signal<WorkspacesSettings> = computed(
    (): WorkspacesSettings => ({
      fileExplorerExpandAll: this.read('workspaces.fileExplorerExpandAll'),
    }),
  );

  /**
   * Gets how the File Explorer's "Expand All" behaves.
   */
  public readonly fileExplorerExpandAll: Signal<FileExplorerExpandAll> = this.value(
    'workspaces.fileExplorerExpandAll',
  );

  /**
   * Gets the AI agent settings.
   */
  public readonly ai: Signal<AiSettings> = computed(
    (): AiSettings => ({
      provider: this.read('ai.provider'),
      models: this.read('ai.models'),
      permissionPosture: this.read('ai.permissionPosture'),
      tokenCap: this.read('ai.tokenCap'),
    }),
  );

  /**
   * Gets the selected AI provider.
   */
  public readonly aiProvider: Signal<AiProviderId> = this.value('ai.provider');

  /**
   * Gets the agent permission posture.
   */
  public readonly aiPermissionPosture: Signal<AiPermissionPosture> = this.value(
    'ai.permissionPosture',
  );

  /**
   * Gets the per-request token cap (0 for no cap).
   */
  public readonly aiTokenCap: Signal<number> = this.value('ai.tokenCap');

  /**
   * Initialises the service, persisting the override map to the store whenever it changes.
   */
  public constructor() {
    effect((): void => {
      this.store.set<SettingsOverrides>(SETTINGS_KEY, this.overrides());
    });
  }

  /**
   * Reads the current value of a setting, resolving the registry default when no override is set.
   * @param key The setting key.
   * @returns Returns the current value.
   */
  public get<K extends SettingsKey>(key: K): SettingsValues[K] {
    return this.read(key);
  }

  /**
   * Returns a reactive signal for a setting's value, memoised per key.
   * @param key The setting key.
   * @returns Returns the value signal.
   */
  public value<K extends SettingsKey>(key: K): Signal<SettingsValues[K]> {
    const existing: Signal<unknown> | undefined = this.valueSignals.get(key);
    if (existing !== undefined) {
      return existing as Signal<SettingsValues[K]>;
    }

    const created: Signal<unknown> = computed((): unknown => this.read(key));
    this.valueSignals.set(key, created);
    return created as Signal<SettingsValues[K]>;
  }

  /**
   * Sets a setting's value, validating it against the registry control (numeric values are rounded and
   * clamped to the configured range).
   * @param key The setting key.
   * @param value The value to set.
   */
  public set<K extends SettingsKey>(key: K, value: SettingsValues[K]): void {
    const validated: unknown = this.validate(key, value);
    this.overrides.update(
      (current: SettingsOverrides): SettingsOverrides => ({ ...current, [key]: validated }),
    );
  }

  /**
   * Returns a reactive value signal typed loosely, for the generic renderer which is key-dynamic.
   * @param key The setting key.
   * @returns Returns the value signal.
   */
  public reactive(key: SettingsKey): Signal<unknown> {
    return this.value(key);
  }

  /**
   * Sets a setting's value from the generic renderer, which is key-dynamic and so cannot supply a
   * statically-typed value.
   * @param key The setting key.
   * @param value The value to set.
   */
  public assign(key: SettingsKey, value: unknown): void {
    this.set(key, value as SettingsValues[SettingsKey]);
  }

  /**
   * Updates the application settings.
   * @param updates The partial application settings to apply.
   */
  public updateApplicationSettings(updates: Partial<ApplicationSettings>): void {
    this.assignSection('application', updates);
  }

  /**
   * Sets the default document type for new documents.
   * @param type The default document type.
   */
  public setDefaultDocumentType(type: DefaultDocumentType): void {
    this.set('application.defaultDocumentType', type);
  }

  /**
   * Updates the appearance settings.
   * @param updates The partial appearance settings to apply.
   */
  public updateAppearanceSettings(updates: Partial<AppearanceSettings>): void {
    this.assignSection('appearance', updates);
  }

  /**
   * Sets the alignment of the ribbon's controls within the ribbon strip.
   * @param alignment The ribbon alignment to apply.
   */
  public setRibbonAlignment(alignment: RibbonAlignment): void {
    this.set('appearance.ribbonAlignment', alignment);
  }

  /**
   * Sets whether the modern UI features are used.
   * @param value The modern UI features mode to apply.
   */
  public setModernUiFeatures(value: ModernUiFeatures): void {
    this.set('appearance.modernUiFeatures', value);
  }

  /**
   * Sets the undo stack size. The value is rounded and clamped to the registry range (10-1000).
   * @param size The requested undo stack size.
   */
  public setUndoStackSize(size: number): void {
    this.set('application.undoStackSize', size);
  }

  /**
   * Sets whether the title strip shows the quick-action launcher buttons in place of the single
   * welcome button.
   * @param value True to show the launcher buttons; false to show the welcome button.
   */
  public setShowLauncherActions(value: boolean): void {
    this.set('application.showLauncherActions', value);
  }

  /**
   * Updates the global text editor settings.
   * @param updates The partial text editor settings to apply.
   */
  public updateTextEditorSettings(updates: Partial<TextEditorSettings>): void {
    this.assignSection('textEditor.global', updates);
  }

  /**
   * Creates a new editor profile.
   * @param name The profile name.
   * @param languages The Monaco language identifiers the profile applies to.
   * @param settings The settings overrides applied by the profile.
   * @returns Returns the created profile.
   */
  public createProfile(
    name: string,
    languages: readonly string[],
    settings: PartialTextEditorSettings = {},
  ): EditorProfile {
    const profile: EditorProfile = {
      id: crypto.randomUUID(),
      name,
      languages,
      settings,
    };

    this.set('textEditor.profiles', [...this.read('textEditor.profiles'), profile]);
    return profile;
  }

  /**
   * Updates an existing editor profile.
   * @param id The identifier of the profile to update.
   * @param updates The updates to apply to the profile.
   */
  public updateProfile(id: string, updates: Partial<Omit<EditorProfile, 'id'>>): void {
    this.set(
      'textEditor.profiles',
      this.read('textEditor.profiles').map(
        (profile: EditorProfile): EditorProfile =>
          profile.id === id ? { ...profile, ...updates } : profile,
      ),
    );
  }

  /**
   * Deletes an editor profile.
   * @param id The identifier of the profile to delete.
   */
  public deleteProfile(id: string): void {
    this.set(
      'textEditor.profiles',
      this.read('textEditor.profiles').filter((profile: EditorProfile): boolean => profile.id !== id),
    );
  }

  /**
   * Resolves the effective text editor settings for a language, merging the first matching profile's
   * overrides over the global settings.
   * @param language The Monaco language identifier.
   * @returns Returns the resolved settings for the language.
   */
  public resolveSettingsForLanguage(language: string): TextEditorSettings {
    const global: TextEditorSettings = this.globalTextEditor();
    const profile: EditorProfile | undefined = this.profiles().find(
      (candidate: EditorProfile): boolean => candidate.languages.includes(language),
    );

    if (profile === undefined) {
      return global;
    }

    return {
      showLineNumbers: profile.settings.showLineNumbers ?? global.showLineNumbers,
      showMinimap: profile.settings.showMinimap ?? global.showMinimap,
      currentLineHighlight: profile.settings.currentLineHighlight ?? global.currentLineHighlight,
      wordWrap: profile.settings.wordWrap ?? global.wordWrap,
      stickyScroll: profile.settings.stickyScroll ?? global.stickyScroll,
      cursorBlinking: profile.settings.cursorBlinking ?? global.cursorBlinking,
      cursorSmoothCaretAnimation:
        profile.settings.cursorSmoothCaretAnimation ?? global.cursorSmoothCaretAnimation,
      insertSpaces: profile.settings.insertSpaces ?? global.insertSpaces,
      tabSize: profile.settings.tabSize ?? global.tabSize,
      fontFamily: profile.settings.fontFamily ?? global.fontFamily,
      fontSize: profile.settings.fontSize ?? global.fontSize,
      braceStyle: profile.settings.braceStyle ?? global.braceStyle,
    };
  }

  /**
   * Updates the markdown editor settings.
   * @param updates The partial markdown editor settings to apply.
   */
  public updateMarkdownEditorSettings(updates: Partial<MarkdownEditorSettings>): void {
    this.assignSection('markdownEditor', updates);
  }

  /**
   * Updates the workspace settings.
   * @param updates The partial workspace settings to apply.
   */
  public updateWorkspacesSettings(updates: Partial<WorkspacesSettings>): void {
    this.assignSection('workspaces', updates);
  }

  /**
   * Sets how the File Explorer's "Expand All" behaves.
   * @param behavior The expand-all behavior to apply.
   */
  public setFileExplorerExpandAll(behavior: FileExplorerExpandAll): void {
    this.set('workspaces.fileExplorerExpandAll', behavior);
  }

  /**
   * Gets the model selected for a provider, or an empty string when none is selected (use the
   * provider's default).
   * @param provider The provider id.
   * @returns Returns the selected model id, or an empty string.
   */
  public aiModelFor(provider: AiProviderId): string {
    return this.read('ai.models')[provider] ?? '';
  }

  /**
   * Updates the AI agent settings.
   * @param updates The partial AI settings to apply.
   */
  public updateAiSettings(updates: Partial<AiSettings>): void {
    this.assignSection('ai', updates);
  }

  /**
   * Sets the selected AI provider.
   * @param provider The provider id.
   */
  public setAiProvider(provider: AiProviderId): void {
    this.set('ai.provider', provider);
  }

  /**
   * Sets the selected model for a provider.
   * @param provider The provider id.
   * @param model The model id.
   */
  public setAiModel(provider: AiProviderId, model: string): void {
    this.set('ai.models', { ...this.read('ai.models'), [provider]: model });
  }

  /**
   * Sets the agent permission posture.
   * @param posture The permission posture.
   */
  public setAiPermissionPosture(posture: AiPermissionPosture): void {
    this.set('ai.permissionPosture', posture);
  }

  /**
   * Sets the per-request token cap. The value is rounded and clamped to the registry range (0 means no
   * cap).
   * @param cap The requested token cap.
   */
  public setAiTokenCap(cap: number): void {
    this.set('ai.tokenCap', cap);
  }

  /**
   * Reads the current value of a setting, resolving the registry default when no override is set.
   * @param key The setting key.
   * @returns Returns the current value.
   */
  private read<K extends SettingsKey>(key: K): SettingsValues[K] {
    const current: SettingsOverrides = this.overrides();
    return (key in current ? current[key] : SETTINGS_DEFAULTS[key]) as SettingsValues[K];
  }

  /**
   * Applies a partial update of a section's fields by mapping each field to its dotted setting key.
   * @param prefix The section key prefix (for example `application` or `textEditor.global`).
   * @param updates The partial fields to apply.
   */
  private assignSection(prefix: string, updates: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(updates)) {
      if (value !== undefined) {
        this.assign(`${prefix}.${field}` as SettingsKey, value);
      }
    }
  }

  /**
   * Validates a value against the registry control: numeric values are rounded and clamped to the
   * control's configured range; all other values pass through unchanged.
   * @param key The setting key.
   * @param value The value to validate.
   * @returns Returns the validated value.
   */
  private validate(key: SettingsKey, value: unknown): unknown {
    const def: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
    if (def?.control.kind !== 'number' || typeof value !== 'number') {
      return value;
    }

    let result: number = Math.round(value);
    if (def.control.min !== undefined) {
      result = Math.max(def.control.min, result);
    }
    if (def.control.max !== undefined) {
      result = Math.min(def.control.max, result);
    }
    return result;
  }

  /**
   * Loads the override map from the store, migrating the legacy nested format forward when present.
   * @returns Returns the restored sparse override map.
   */
  private load(): SettingsOverrides {
    const raw: unknown = this.store.get<unknown>(SETTINGS_KEY, null);
    if (raw === null || typeof raw !== 'object') {
      return {};
    }

    const record: Record<string, unknown> = raw as Record<string, unknown>;
    if (Object.keys(record).some((key: string): boolean => key.includes('.'))) {
      return { ...record };
    }

    return this.migrateLegacy(record);
  }

  /**
   * Determines whether the persisted text editor settings use the profile-aware format.
   * @param settings The persisted text editor settings.
   * @returns Returns true when the settings use the profile-aware format; otherwise, false.
   */
  private isProfileAwareFormat(
    settings: LegacyTextEditorSettings | TextEditorSettingsWithProfiles | undefined,
  ): settings is TextEditorSettingsWithProfiles {
    return settings !== undefined && 'global' in settings && 'profiles' in settings;
  }

  /**
   * Migrates the legacy nested settings shape into the flat override map, preserving only values the
   * user had set.
   * @param legacy The persisted legacy settings.
   * @returns Returns the migrated sparse override map.
   */
  private migrateLegacy(legacy: LegacyAppSettings): SettingsOverrides {
    const overrides: Record<string, unknown> = {};

    function put(key: string, value: unknown): void {
      if (value !== undefined) {
        overrides[key] = value;
      }
    }

    function putAll(prefix: string, source: object | undefined): void {
      for (const [field, value] of Object.entries(source ?? {})) {
        put(`${prefix}.${field}`, value);
      }
    }

    putAll('application', legacy.application);
    putAll('appearance', legacy.appearance);

    const textEditor: LegacyTextEditorSettings | TextEditorSettingsWithProfiles | undefined =
      legacy.textEditor;
    if (this.isProfileAwareFormat(textEditor)) {
      putAll('textEditor.global', textEditor.global);
      put('textEditor.profiles', textEditor.profiles);
    } else {
      putAll('textEditor.global', textEditor);
    }

    putAll('markdownEditor', legacy.markdownEditor);
    putAll('ai', legacy.ai);
    putAll('workspaces', legacy.workspaces);

    return overrides;
  }
}
