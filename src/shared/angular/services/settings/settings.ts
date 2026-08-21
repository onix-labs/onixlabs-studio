import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type {
  AiConnection,
  AiPermissionPosture,
  AiRemoteControlPosture,
  AiToolPolicy,
  ClaudeExecutableMode,
} from '@shared/api/ai-types';
import {
  AiConnectionModels,
  SETTINGS_BY_KEY,
  SETTINGS_DEFAULTS,
  SettingsKey,
  SettingsValues,
  TileScrollMode,
} from './settings-registry';
import { SettingDef } from './settings-schema';
import { Log } from '@shared/angular/services/log/log';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { restoreOverrides } from './settings-migration';
import {
  addProfile,
  AddProfileResult,
  removeProfile,
  resolveForLanguage,
  updateProfileIn,
} from './settings-profiles';

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
 * Identifies what the markdown editor's Select All (Cmd/Ctrl+A) chord selects: the current block, or
 * the whole document. The secondary chord (Cmd/Ctrl+Shift+A) always selects the other one.
 */
export type SelectAllScope = 'block' | 'document';

/**
 * Identifies the page margin applied when printing or exporting a document: `narrow` is the tightest,
 * `regular` doubles it, and `wide` doubles it again.
 */
export type PrintMargin = 'narrow' | 'regular' | 'wide';

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
 * Identifies the optional background texture tiled behind the workspace's docked panes. `none` is a
 * plain backdrop; every other value names a pattern in the texture catalogue
 * (`styles/_textures.scss`), which paints it in the theme's own colour.
 */
export type WorkspaceTexture =
  | 'none'
  | 'texture'
  | 'hideout'
  | 'tiny-checkers'
  | 'bubbles'
  | 'diagonal-stripes'
  | 'houndstooth'
  | 'rain'
  | 'circuit-board'
  | 'diagonal-lines'
  | 'polka-dots'
  | 'signal';

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
   * Gets a value indicating whether matching bracket pairs are coloured by their nesting depth.
   */
  readonly colorBrackets: boolean;

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
   * Gets the editor line height as a multiple of the font size; 0 derives it automatically.
   */
  readonly lineHeight: number;

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
   * Gets the maximum number of undo steps kept in history.
   */
  readonly undoStackSize: number;

  /**
   * Gets the page margin applied when printing or exporting a document.
   */
  readonly printMargin: PrintMargin;
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

  /**
   * Gets the background texture tiled behind the workspace's docked panes.
   */
  readonly workspaceTexture: WorkspaceTexture;
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
   * Gets what the Select All chord selects first (the other is on the Shift chord).
   */
  readonly selectAllScope: SelectAllScope;
}

/**
 * Defines the AI agent settings. Provider and per-provider model selection are persisted here so the
 * agent restores the user's choice across sessions; the agent reads and writes them through this
 * service rather than holding its own in-memory selection.
 */
export interface AiSettings {
  /**
   * Gets the configured provider connections (each a back-end, credential, and model list). Seeded
   * with the default connections on a fresh install; fully user-editable.
   */
  readonly connections: readonly AiConnection[];

  /**
   * Gets the id of the connection the agent runs turns through.
   */
  readonly activeConnectionId: string;

  /**
   * Gets the model last selected per connection, keyed by connection id. A missing entry means "use
   * the connection's default model".
   */
  readonly connectionModels: AiConnectionModels;

  /**
   * Gets how much the agent may do without asking the user first.
   */
  readonly permissionPosture: AiPermissionPosture;

  /**
   * Gets the per-request token budget, or 0 for the provider default (no cap).
   */
  readonly tokenCap: number;

  /**
   * Gets the wall-clock limit a run is aborted after, in minutes, or 0 for no limit. The clock
   * pauses while the run waits on the user (a permission, question, or edit decision).
   */
  readonly runTimeoutMinutes: number;
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
 * Defines the persisted, sparse override map: only keys the user has changed from their default are
 * stored. Any absent key falls back to the registry default.
 */
export type SettingsOverrides = Partial<Record<SettingsKey, unknown>>;

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
      undoStackSize: this.read('application.undoStackSize'),
      printMargin: this.read('application.printMargin'),
    }),
  );

  /**
   * Gets the appearance settings.
   */
  public readonly appearance: Signal<AppearanceSettings> = computed(
    (): AppearanceSettings => ({
      ribbonAlignment: this.read('appearance.ribbonAlignment'),
      modernUiFeatures: this.read('appearance.modernUiFeatures'),
      workspaceTexture: this.read('appearance.workspaceTexture'),
    }),
  );

  /**
   * Gets the alignment of the ribbon's controls within the ribbon strip.
   */
  public readonly ribbonAlignment: Signal<RibbonAlignment> = this.value(
    'appearance.ribbonAlignment',
  );

  /**
   * Gets whether the modern UI features are used, or whether the choice follows the GPU-derived
   * recommendation.
   */
  public readonly modernUiFeatures: Signal<ModernUiFeatures> = this.value(
    'appearance.modernUiFeatures',
  );

  /**
   * Gets the background texture tiled behind the workspace's docked panes.
   */
  public readonly workspaceTexture: Signal<WorkspaceTexture> = this.value(
    'appearance.workspaceTexture',
  );

  /**
   * Gets the undo stack size.
   */
  public readonly undoStackSize: Signal<number> = this.value('application.undoStackSize');

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
   * Gets whether the editor selection uses the accent colour (#314). A global editor look rather than
   * a per-language profile setting, so it is exposed directly rather than via {@link globalTextEditor}.
   */
  public readonly textEditorAccentSelection: Signal<boolean> = this.value(
    'textEditor.global.accentSelection',
  );

  /**
   * Gets the global text editor settings.
   */
  public readonly globalTextEditor: Signal<TextEditorSettings> = computed(
    (): TextEditorSettings => ({
      showLineNumbers: this.read('textEditor.global.showLineNumbers'),
      showMinimap: this.read('textEditor.global.showMinimap'),
      currentLineHighlight: this.read('textEditor.global.currentLineHighlight'),
      colorBrackets: this.read('textEditor.global.colorBrackets'),
      wordWrap: this.read('textEditor.global.wordWrap'),
      stickyScroll: this.read('textEditor.global.stickyScroll'),
      cursorBlinking: this.read('textEditor.global.cursorBlinking'),
      cursorSmoothCaretAnimation: this.read('textEditor.global.cursorSmoothCaretAnimation'),
      insertSpaces: this.read('textEditor.global.insertSpaces'),
      tabSize: this.read('textEditor.global.tabSize'),
      fontFamily: this.read('textEditor.global.fontFamily'),
      fontSize: this.read('textEditor.global.fontSize'),
      lineHeight: this.read('textEditor.global.lineHeight'),
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
      selectAllScope: this.read('markdownEditor.selectAllScope'),
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
      connections: this.read('ai.connections'),
      activeConnectionId: this.read('ai.activeConnectionId'),
      connectionModels: this.read('ai.connectionModels'),
      permissionPosture: this.read('ai.permissionPosture'),
      tokenCap: this.read('ai.tokenCap'),
      runTimeoutMinutes: this.read('ai.runTimeoutMinutes'),
    }),
  );

  /**
   * Gets the configured provider connections.
   */
  public readonly aiConnections: Signal<readonly AiConnection[]> = this.value('ai.connections');

  /**
   * Gets the id of the active connection.
   */
  public readonly aiActiveConnectionId: Signal<string> = this.value('ai.activeConnectionId');

  /**
   * Gets the model-per-connection selection map.
   */
  public readonly aiConnectionModels: Signal<AiConnectionModels> =
    this.value('ai.connectionModels');

  /**
   * Gets whether agent transcripts follow new content to the bottom as it streams (applies to every
   * agent view).
   */
  public readonly aiAutoScroll: Signal<boolean> = this.value('ai.autoScroll');

  /**
   * Gets the active connection, or undefined when no connection matches the active id (for example
   * after the active connection was removed).
   */
  public readonly aiActiveConnection: Signal<AiConnection | undefined> = computed(
    (): AiConnection | undefined => {
      const id: string = this.aiActiveConnectionId();
      return this.aiConnections().find((connection: AiConnection): boolean => connection.id === id);
    },
  );

  /**
   * Gets the agent permission posture.
   */
  public readonly aiPermissionPosture: Signal<AiPermissionPosture> =
    this.value('ai.permissionPosture');

  /**
   * Gets how much a remote peer may do on an agent exposed via Remote Control. An agent's own control
   * is a plain on/off toggle; this is what being on means.
   */
  public readonly aiRemoteControlPosture: Signal<AiRemoteControlPosture> =
    this.value('ai.remoteControlPosture');

  /**
   * Gets the user's default allow/ask/deny decision per gateable tool, keyed by tool display name.
   * A missing entry means "ask" (the posture decides).
   */
  public readonly aiToolPolicies: Signal<Readonly<Record<string, AiToolPolicy>>> =
    this.value('ai.toolPolicies');

  /**
   * Gets the extra directories the agent may write to beyond the workspace root (absolute paths).
   */
  public readonly aiAllowedWritePaths: Signal<readonly string[]> =
    this.value('ai.allowedWritePaths');

  /**
   * Gets the paths the agent may never write to (absolute paths or bare path segments).
   */
  public readonly aiDeniedWritePaths: Signal<readonly string[]> = this.value('ai.deniedWritePaths');

  /**
   * Gets the hosts the agent may reach; empty allows any.
   */
  public readonly aiAllowedNetworkLocations: Signal<readonly string[]> = this.value(
    'ai.allowedNetworkLocations',
  );

  /**
   * Gets the hosts the agent may never reach.
   */
  public readonly aiDeniedNetworkLocations: Signal<readonly string[]> = this.value(
    'ai.deniedNetworkLocations',
  );

  /**
   * Gets the per-request token cap (0 for no cap).
   */
  public readonly aiTokenCap: Signal<number> = this.value('ai.tokenCap');

  /**
   * Gets the wall-clock run limit in minutes (0 for no limit).
   */
  public readonly aiRunTimeoutMinutes: Signal<number> = this.value('ai.runTimeoutMinutes');

  /**
   * Gets how long (in minutes) an idle agent keeps its live session before idle-reap closes it, or 0 to
   * never reap on idle. A reaped session reopens transparently (via resume) on the next message.
   */
  public readonly aiAgentSessionLifetimeMinutes: Signal<number> =
    this.value('ai.agentSessionLifetime');

  /**
   * Gets the shell whose login profile the agent sources its environment from (an absolute path), or
   * the empty string to inherit the default login shell's environment.
   */
  public readonly aiAgentShell: Signal<string> = this.value('ai.agentShell');

  /**
   * Gets which Claude Code CLI the Claude agent spawns (bundled, system, or a custom path).
   */
  public readonly aiClaudeExecutable: Signal<ClaudeExecutableMode> =
    this.value('ai.claudeExecutable');

  /**
   * Gets the absolute path to the Claude CLI used when {@link aiClaudeExecutable} is `custom`.
   */
  public readonly aiClaudeExecutablePath: Signal<string> = this.value('ai.claudeExecutablePath');

  /**
   * Gets whether Mission Control floats agents awaiting a permission request to the top of its agent
   * list (the columns keep their order regardless).
   */
  public readonly missionControlShowPermissionsAtTop: Signal<boolean> = this.value(
    'missionControl.showPermissionsAtTop',
  );

  /**
   * Gets how the Mission Control agent rail scrolls a clicked agent's column into view.
   */
  public readonly missionControlTileScrollMode: Signal<TileScrollMode> = this.value(
    'missionControl.tileScrollMode',
  );

  /**
   * Holds the last override map applied from another window's write, so the auto-persist effect can
   * tell an externally-sourced state (which must not be written back) from a local edit. The browser
   * never fires the storage notification in the writing window, so this guard only ever suppresses
   * the redundant re-write of a value that is already in the store.
   */
  private externallyApplied: SettingsOverrides | null = null;

  /**
   * Initialises the service: persists the override map to the store whenever it changes locally, and
   * follows changes other windows make to it (a pop-out window tracking the main window's settings —
   * and the reverse), so every window's signals reflect the latest write.
   */
  public constructor() {
    effect((): void => {
      const overrides: SettingsOverrides = this.overrides();
      if (overrides !== this.externallyApplied) {
        this.store.set<SettingsOverrides>(SETTINGS_KEY, overrides);
      }
    });
    this.store.onExternalChange(SETTINGS_KEY, (): void => {
      const loaded: SettingsOverrides = this.load();
      this.externallyApplied = loaded;
      this.overrides.set(loaded);
      this.log.debug('Settings', 'Applied settings changed by another window');
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
   * Sets the background texture tiled behind the workspace's docked panes.
   * @param value The texture to apply.
   */
  public setWorkspaceTexture(value: WorkspaceTexture): void {
    this.set('appearance.workspaceTexture', value);
  }

  /**
   * Sets the undo stack size.
   * @param size The requested undo stack size.
   */
  public setUndoStackSize(size: number): void {
    this.set('application.undoStackSize', size);
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
    const result: AddProfileResult = addProfile(
      this.read('textEditor.profiles'),
      name,
      languages,
      settings,
    );
    this.set('textEditor.profiles', result.next);
    this.log.info('Settings', `Created editor profile '${name}'`, result.profile.id, languages);
    return result.profile;
  }

  /**
   * Updates an existing editor profile.
   * @param id The identifier of the profile to update.
   * @param updates The updates to apply to the profile.
   */
  public updateProfile(id: string, updates: Partial<Omit<EditorProfile, 'id'>>): void {
    this.set('textEditor.profiles', updateProfileIn(this.read('textEditor.profiles'), id, updates));
    this.log.info('Settings', `Updated editor profile`, id);
  }

  /**
   * Deletes an editor profile.
   * @param id The identifier of the profile to delete.
   */
  public deleteProfile(id: string): void {
    this.set('textEditor.profiles', removeProfile(this.read('textEditor.profiles'), id));
    this.log.info('Settings', `Deleted editor profile`, id);
  }

  /**
   * Resolves the effective text editor settings for a language, merging the first matching profile's
   * overrides over the global settings.
   * @param language The Monaco language identifier.
   * @returns Returns the resolved settings for the language.
   */
  public resolveSettingsForLanguage(language: string): TextEditorSettings {
    return resolveForLanguage(this.globalTextEditor(), this.profiles(), language);
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
   * Updates the AI agent settings.
   * @param updates The partial AI settings to apply.
   */
  public updateAiSettings(updates: Partial<AiSettings>): void {
    this.assignSection('ai', updates);
  }

  /**
   * Gets the model selected for a connection, or an empty string when none is selected (use the
   * connection's default).
   * @param connectionId The connection id.
   * @returns Returns the selected model id, or an empty string.
   */
  public connectionModelFor(connectionId: string): string {
    return this.read('ai.connectionModels')[connectionId] ?? '';
  }

  /**
   * Replaces the whole connection list.
   * @param connections The connections to persist.
   */
  public setAiConnections(connections: readonly AiConnection[]): void {
    this.set('ai.connections', connections);
  }

  /**
   * Adds a connection, or replaces an existing one with the same id.
   * @param connection The connection to add or update.
   */
  public upsertConnection(connection: AiConnection): void {
    const existing: readonly AiConnection[] = this.read('ai.connections');
    const index: number = existing.findIndex(
      (candidate: AiConnection): boolean => candidate.id === connection.id,
    );
    const next: AiConnection[] =
      index === -1
        ? [...existing, connection]
        : existing.map(
            (candidate: AiConnection, i: number): AiConnection =>
              i === index ? connection : candidate,
          );
    this.set('ai.connections', next);
    this.log.info(
      'Settings',
      `${index === -1 ? 'Added' : 'Updated'} AI connection '${connection.label}'`,
      connection.id,
    );
  }

  /**
   * Removes the connection with the given id. When the removed connection was active, the active id
   * falls back to the first remaining connection (or an empty string when none remain), and its
   * remembered model selection is dropped.
   * @param connectionId The id of the connection to remove.
   */
  public removeConnection(connectionId: string): void {
    const remaining: readonly AiConnection[] = this.read('ai.connections').filter(
      (connection: AiConnection): boolean => connection.id !== connectionId,
    );
    this.set('ai.connections', remaining);
    this.log.info('Settings', `Removed AI connection`, connectionId);

    if (this.read('ai.activeConnectionId') === connectionId) {
      this.set('ai.activeConnectionId', remaining[0]?.id ?? '');
    }

    const models: AiConnectionModels = this.read('ai.connectionModels');
    if (connectionId in models) {
      const rest: Record<string, string> = {};
      for (const [id, model] of Object.entries(models)) {
        if (id !== connectionId) {
          rest[id] = model;
        }
      }
      this.set('ai.connectionModels', rest);
    }
  }

  /**
   * Sets the active connection.
   * @param connectionId The id of the connection to make active.
   */
  public setActiveConnection(connectionId: string): void {
    this.set('ai.activeConnectionId', connectionId);
    this.log.info('Settings', `Active AI connection changed`, connectionId);
  }

  /**
   * Sets the selected model for a connection.
   * @param connectionId The connection id.
   * @param model The model id.
   */
  public setConnectionModel(connectionId: string, model: string): void {
    this.set('ai.connectionModels', {
      ...this.read('ai.connectionModels'),
      [connectionId]: model,
    });
  }

  /**
   * Sets the agent permission posture.
   * @param posture The permission posture.
   */
  public setAiPermissionPosture(posture: AiPermissionPosture): void {
    this.set('ai.permissionPosture', posture);
    this.log.info('Settings', `Agent permission posture set to '${posture}'`);
  }

  /**
   * Sets how much a remote peer may do on an agent exposed via Remote Control.
   * @param posture The remote-control posture.
   */
  public setAiRemoteControlPosture(posture: AiRemoteControlPosture): void {
    this.set('ai.remoteControlPosture', posture);
    this.log.info('Settings', `Agent remote control posture set to '${posture}'`);
  }

  /**
   * Sets the user's default policy for a single tool, keyed by its display name. Setting a tool back
   * to `ask` drops it from the map (ask is the default, so the map stays sparse).
   * @param tool The tool's display name.
   * @param policy The default policy for the tool.
   */
  public setAiToolPolicy(tool: string, policy: AiToolPolicy): void {
    const next: Record<string, AiToolPolicy> = { ...this.aiToolPolicies() };
    if (policy === 'ask') {
      delete next[tool];
    } else {
      next[tool] = policy;
    }
    this.set('ai.toolPolicies', next);
  }

  /**
   * Replaces the agent's allowed write paths (extra writable directories beyond the workspace).
   * @param paths The absolute directory paths.
   */
  public setAiAllowedWritePaths(paths: readonly string[]): void {
    this.set('ai.allowedWritePaths', [...paths]);
  }

  /**
   * Replaces the agent's denied write paths (never-writable paths or path segments).
   * @param paths The deny entries.
   */
  public setAiDeniedWritePaths(paths: readonly string[]): void {
    this.set('ai.deniedWritePaths', [...paths]);
  }

  /**
   * Replaces the hosts the agent may reach. Empty allows any host.
   * @param locations The allowed hosts.
   */
  public setAiAllowedNetworkLocations(locations: readonly string[]): void {
    this.set('ai.allowedNetworkLocations', [...locations]);
  }

  /**
   * Replaces the hosts the agent may never reach.
   * @param locations The denied hosts.
   */
  public setAiDeniedNetworkLocations(locations: readonly string[]): void {
    this.set('ai.deniedNetworkLocations', [...locations]);
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
   * Validates a value against the registry control: numeric values are snapped to the control's step
   * and clamped to its configured range; all other values pass through unchanged.
   * @param key The setting key.
   * @param value The value to validate.
   * @returns Returns the validated value.
   */
  private validate(key: SettingsKey, value: unknown): unknown {
    const def: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
    if (def?.control.kind !== 'number' || typeof value !== 'number') {
      return value;
    }

    // Round to the decimal precision implied by the control's step rather than always to an integer, so
    // a fractional step (such as the line-height multiplier's 0.1) keeps its decimals. An integer step —
    // including a coarse one like a token cap's 1000, which is only a UI increment — still rounds to a
    // whole number without snapping to that step.
    const step: number = def.control.step ?? 1;
    const decimals: number = (String(step).split('.')[1] ?? '').length;
    let result: number = decimals === 0 ? Math.round(value) : Number(value.toFixed(decimals));
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
    return restoreOverrides(this.store.get<unknown>(SETTINGS_KEY, null));
  }
}
