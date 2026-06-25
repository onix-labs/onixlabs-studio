import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiPermissionPosture, AiProviderId } from '../../../shared/ai-types';
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
  readonly models: Readonly<Partial<Record<AiProviderId, string>>>;

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
}

/**
 * Defines the legacy text editor settings format (a flat object without profiles), retained so
 * settings persisted by an earlier version can be migrated forward.
 */
type LegacyTextEditorSettings = Partial<TextEditorSettings>;

/**
 * Defines the legacy persisted settings shape accepted by the migration path.
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
}

/**
 * Holds the default application settings.
 */
const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  defaultDocumentType: 'code',
  undoStackSize: 100,
};

/**
 * Holds the default appearance settings.
 */
const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  ribbonAlignment: 'left',
  modernUiFeatures: 'auto',
};

/**
 * Holds the default global text editor settings.
 */
const DEFAULT_TEXT_EDITOR_SETTINGS: TextEditorSettings = {
  showLineNumbers: true,
  showMinimap: true,
  currentLineHighlight: 'outline',
  wordWrap: false,
  stickyScroll: true,
  cursorBlinking: 'blink',
  cursorSmoothCaretAnimation: 'off',
  insertSpaces: true,
  tabSize: 2,
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
};

/**
 * Holds the default markdown editor settings.
 */
const DEFAULT_MARKDOWN_EDITOR_SETTINGS: MarkdownEditorSettings = {
  fontFamily: 'System Default',
  monospaceFontFamily: 'JetBrains Mono',
  fontSize: 16,
  marginSize: 'medium',
  imageSizing: 'fixed',
  imageAlignment: 'left',
  panelPosition: 'right',
};

/**
 * Holds the default AI agent settings.
 */
const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'claude',
  models: {},
  permissionPosture: 'prompt',
  tokenCap: 0,
};

/**
 * Holds the settings-store key under which the settings are persisted.
 */
const SETTINGS_KEY: string = 'settings';

/**
 * Holds the minimum allowed undo stack size.
 */
const MIN_UNDO_STACK_SIZE: number = 10;

/**
 * Holds the maximum allowed undo stack size.
 */
const MAX_UNDO_STACK_SIZE: number = 1000;

/**
 * Holds the maximum allowed per-request token cap.
 */
const MAX_TOKEN_CAP: number = 1_000_000;

/**
 * Represents the source of truth for application, text editor and markdown editor settings.
 *
 * State is restored from the {@link SettingsStore} on construction (merging persisted values with
 * defaults, and migrating the legacy text-editor format), exposed as signals, and auto-persisted by
 * an effect whenever it changes.
 */
@Service()
export class Settings {
  /**
   * Holds the settings store used to persist and restore settings.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the current settings state.
   */
  private readonly settingsSignal: WritableSignal<AppSettings> = signal<AppSettings>(this.load());

  /**
   * Gets the complete settings.
   */
  public readonly settings: Signal<AppSettings> = this.settingsSignal.asReadonly();

  /**
   * Gets the application-level settings.
   */
  public readonly application: Signal<ApplicationSettings> = computed(
    (): ApplicationSettings => this.settingsSignal().application,
  );

  /**
   * Gets the appearance settings.
   */
  public readonly appearance: Signal<AppearanceSettings> = computed(
    (): AppearanceSettings => this.settingsSignal().appearance,
  );

  /**
   * Gets the alignment of the ribbon's controls within the ribbon strip.
   */
  public readonly ribbonAlignment: Signal<RibbonAlignment> = computed(
    (): RibbonAlignment => this.settingsSignal().appearance.ribbonAlignment,
  );

  /**
   * Gets whether the modern UI features are used, or whether the choice follows the GPU-derived
   * recommendation.
   */
  public readonly modernUiFeatures: Signal<ModernUiFeatures> = computed(
    (): ModernUiFeatures => this.settingsSignal().appearance.modernUiFeatures,
  );

  /**
   * Gets the default document type for new documents.
   */
  public readonly defaultDocumentType: Signal<DefaultDocumentType> = computed(
    (): DefaultDocumentType => this.settingsSignal().application.defaultDocumentType,
  );

  /**
   * Gets the undo stack size.
   */
  public readonly undoStackSize: Signal<number> = computed(
    (): number => this.settingsSignal().application.undoStackSize,
  );

  /**
   * Gets the text editor settings with profiles.
   */
  public readonly textEditor: Signal<TextEditorSettingsWithProfiles> = computed(
    (): TextEditorSettingsWithProfiles => this.settingsSignal().textEditor,
  );

  /**
   * Gets the global text editor settings.
   */
  public readonly globalTextEditor: Signal<TextEditorSettings> = computed(
    (): TextEditorSettings => this.settingsSignal().textEditor.global,
  );

  /**
   * Gets the editor profiles.
   */
  public readonly profiles: Signal<readonly EditorProfile[]> = computed(
    (): readonly EditorProfile[] => this.settingsSignal().textEditor.profiles,
  );

  /**
   * Gets the markdown editor settings.
   */
  public readonly markdownEditor: Signal<MarkdownEditorSettings> = computed(
    (): MarkdownEditorSettings => this.settingsSignal().markdownEditor,
  );

  /**
   * Gets the AI agent settings.
   */
  public readonly ai: Signal<AiSettings> = computed((): AiSettings => this.settingsSignal().ai);

  /**
   * Gets the selected AI provider.
   */
  public readonly aiProvider: Signal<AiProviderId> = computed(
    (): AiProviderId => this.settingsSignal().ai.provider,
  );

  /**
   * Gets the agent permission posture.
   */
  public readonly aiPermissionPosture: Signal<AiPermissionPosture> = computed(
    (): AiPermissionPosture => this.settingsSignal().ai.permissionPosture,
  );

  /**
   * Gets the per-request token cap (0 for no cap).
   */
  public readonly aiTokenCap: Signal<number> = computed(
    (): number => this.settingsSignal().ai.tokenCap,
  );

  /**
   * Initialises the service, persisting settings to the store whenever they change.
   */
  public constructor() {
    effect((): void => {
      this.store.set<AppSettings>(SETTINGS_KEY, this.settingsSignal());
    });
  }

  /**
   * Updates the application settings.
   * @param updates The partial application settings to apply.
   */
  public updateApplicationSettings(updates: Partial<ApplicationSettings>): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        application: { ...current.application, ...updates },
      }),
    );
  }

  /**
   * Sets the default document type for new documents.
   * @param type The default document type.
   */
  public setDefaultDocumentType(type: DefaultDocumentType): void {
    this.updateApplicationSettings({ defaultDocumentType: type });
  }

  /**
   * Updates the appearance settings.
   * @param updates The partial appearance settings to apply.
   */
  public updateAppearanceSettings(updates: Partial<AppearanceSettings>): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        appearance: { ...current.appearance, ...updates },
      }),
    );
  }

  /**
   * Sets the alignment of the ribbon's controls within the ribbon strip.
   * @param alignment The ribbon alignment to apply.
   */
  public setRibbonAlignment(alignment: RibbonAlignment): void {
    this.updateAppearanceSettings({ ribbonAlignment: alignment });
  }

  /**
   * Sets whether the modern UI features are used.
   * @param value The modern UI features mode to apply.
   */
  public setModernUiFeatures(value: ModernUiFeatures): void {
    this.updateAppearanceSettings({ modernUiFeatures: value });
  }

  /**
   * Sets the undo stack size, clamping it to the valid range (10-1000) and rounding to an integer.
   * @param size The requested undo stack size.
   */
  public setUndoStackSize(size: number): void {
    const clamped: number = Math.max(
      MIN_UNDO_STACK_SIZE,
      Math.min(MAX_UNDO_STACK_SIZE, Math.round(size)),
    );
    this.updateApplicationSettings({ undoStackSize: clamped });
  }

  /**
   * Updates the global text editor settings.
   * @param updates The partial text editor settings to apply.
   */
  public updateTextEditorSettings(updates: Partial<TextEditorSettings>): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        textEditor: {
          ...current.textEditor,
          global: { ...current.textEditor.global, ...updates },
        },
      }),
    );
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

    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        textEditor: {
          ...current.textEditor,
          profiles: [...current.textEditor.profiles, profile],
        },
      }),
    );

    return profile;
  }

  /**
   * Updates an existing editor profile.
   * @param id The identifier of the profile to update.
   * @param updates The updates to apply to the profile.
   */
  public updateProfile(id: string, updates: Partial<Omit<EditorProfile, 'id'>>): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        textEditor: {
          ...current.textEditor,
          profiles: current.textEditor.profiles.map(
            (profile: EditorProfile): EditorProfile =>
              profile.id === id ? { ...profile, ...updates } : profile,
          ),
        },
      }),
    );
  }

  /**
   * Deletes an editor profile.
   * @param id The identifier of the profile to delete.
   */
  public deleteProfile(id: string): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        textEditor: {
          ...current.textEditor,
          profiles: current.textEditor.profiles.filter(
            (profile: EditorProfile): boolean => profile.id !== id,
          ),
        },
      }),
    );
  }

  /**
   * Resolves the effective text editor settings for a language, merging the first matching profile's
   * overrides over the global settings.
   * @param language The Monaco language identifier.
   * @returns Returns the resolved settings for the language.
   */
  public resolveSettingsForLanguage(language: string): TextEditorSettings {
    const current: AppSettings = this.settingsSignal();
    const global: TextEditorSettings = current.textEditor.global;
    const profile: EditorProfile | undefined = current.textEditor.profiles.find(
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
    };
  }

  /**
   * Updates the markdown editor settings.
   * @param updates The partial markdown editor settings to apply.
   */
  public updateMarkdownEditorSettings(updates: Partial<MarkdownEditorSettings>): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        markdownEditor: { ...current.markdownEditor, ...updates },
      }),
    );
  }

  /**
   * Gets the model selected for a provider, or an empty string when none is selected (use the
   * provider's default).
   * @param provider The provider id.
   * @returns Returns the selected model id, or an empty string.
   */
  public aiModelFor(provider: AiProviderId): string {
    return this.settingsSignal().ai.models[provider] ?? '';
  }

  /**
   * Updates the AI agent settings.
   * @param updates The partial AI settings to apply.
   */
  public updateAiSettings(updates: Partial<AiSettings>): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        ai: { ...current.ai, ...updates },
      }),
    );
  }

  /**
   * Sets the selected AI provider.
   * @param provider The provider id.
   */
  public setAiProvider(provider: AiProviderId): void {
    this.updateAiSettings({ provider });
  }

  /**
   * Sets the selected model for a provider.
   * @param provider The provider id.
   * @param model The model id.
   */
  public setAiModel(provider: AiProviderId, model: string): void {
    this.settingsSignal.update(
      (current: AppSettings): AppSettings => ({
        ...current,
        ai: { ...current.ai, models: { ...current.ai.models, [provider]: model } },
      }),
    );
  }

  /**
   * Sets the agent permission posture.
   * @param posture The permission posture.
   */
  public setAiPermissionPosture(posture: AiPermissionPosture): void {
    this.updateAiSettings({ permissionPosture: posture });
  }

  /**
   * Sets the per-request token cap, clamping it to a non-negative integer (0 means no cap).
   * @param cap The requested token cap.
   */
  public setAiTokenCap(cap: number): void {
    const clamped: number = Math.max(0, Math.min(MAX_TOKEN_CAP, Math.round(cap)));
    this.updateAiSettings({ tokenCap: clamped });
  }

  /**
   * Loads the settings from the store, merging persisted values with defaults.
   * @returns Returns the restored, fully populated settings.
   */
  private load(): AppSettings {
    return this.mergeWithDefaults(this.store.get<LegacyAppSettings>(SETTINGS_KEY, {}));
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
   * Merges persisted settings with defaults, migrating the legacy text-editor format when present.
   * @param partial The persisted settings, which may be in a legacy format.
   * @returns Returns the fully populated settings.
   */
  private mergeWithDefaults(partial: LegacyAppSettings): AppSettings {
    let textEditor: TextEditorSettingsWithProfiles;

    if (this.isProfileAwareFormat(partial.textEditor)) {
      textEditor = {
        global: { ...DEFAULT_TEXT_EDITOR_SETTINGS, ...partial.textEditor.global },
        profiles: partial.textEditor.profiles ?? [],
      };
    } else {
      textEditor = {
        global: { ...DEFAULT_TEXT_EDITOR_SETTINGS, ...partial.textEditor },
        profiles: [],
      };
    }

    return {
      application: { ...DEFAULT_APPLICATION_SETTINGS, ...partial.application },
      appearance: { ...DEFAULT_APPEARANCE_SETTINGS, ...partial.appearance },
      textEditor,
      markdownEditor: { ...DEFAULT_MARKDOWN_EDITOR_SETTINGS, ...partial.markdownEditor },
      ai: {
        ...DEFAULT_AI_SETTINGS,
        ...partial.ai,
        models: { ...(partial.ai?.models ?? {}) },
      },
    };
  }
}
