import {
  computed,
  DestroyRef,
  effect,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type {
  AiConnection,
  AiPermissionPosture,
  AiRemoteControlPosture,
  AiToolPolicy,
  ClaudeExecutableMode,
  CodexExecutableMode,
} from '@shared/api/ai-types';
import {
  AiConnectionModels,
  ConversationTextSize,
  DatabaseGridlines,
  DatabaseGridlineTone,
  DatabaseSelectAction,
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
  clearLanguageOverride,
  resolveForLanguage,
  setLanguageOverride,
} from './settings-language-overrides';

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
 * Identifies which whitespace the editor draws: none, between words only, in the selection, at the
 * ends of lines, or all of it.
 */
export type RenderWhitespace = 'none' | 'boundary' | 'selection' | 'trailing' | 'all';

/**
 * Identifies how indentation is guided: not at all, with a line per level, or with the active level
 * also highlighted.
 */
export type IndentGuides = 'off' | 'on' | 'highlight-active';

/**
 * Identifies which bracket pairs get a guide: none, the pair around the caret, or all of them.
 */
export type BracketPairGuides = 'off' | 'active' | 'all';

/**
 * Identifies the shape of the text editor cursor.
 */
export type EditorCursorStyle = 'line' | 'block' | 'underline';

/**
 * Identifies when the fold controls show in the gutter: always, or while the pointer is over it.
 */
export type FoldingControls = 'always' | 'hover';

/**
 * Identifies what folds a language's code: the best there is (the language server where one folds, the
 * brace folding, then indentation), the language server, the brace folding, or indentation alone.
 */
export type FoldingProvider = 'automatic' | 'language-server' | 'braces' | 'indentation';

/**
 * Identifies which formatter a language with a built-in one uses: that, or its language server's.
 */
export type DefaultFormatter = 'built-in' | 'language-server';

/**
 * Identifies what the change margin marks: nothing, lines that differ from the saved file, or those
 * and the lines in sync with it.
 */
export type ChangeMarginMode = 'off' | 'unsaved' | 'all';

/**
 * Identifies when inlay hints show: always, never, or while a modifier is held.
 */
export type InlayHintsMode = 'on' | 'off' | 'while-holding';

/**
 * Identifies the least severe diagnostic an editor underlines.
 */
export type MinimumDiagnosticSeverity = 'hint' | 'info' | 'warning' | 'error';

/**
 * Identifies what a save formats: nothing, the whole file, or the lines changed since the last save.
 */
export type FormatOnSave = 'off' | 'whole' | 'changed';

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
 * Identifies the paper a document is printed or exported on; `system` picks Letter or A4 by the
 * region of the system locale.
 */
export type PrintPaperSize = 'system' | 'a4' | 'letter' | 'legal' | 'a3';

/**
 * Identifies which way up a printed or exported page is laid out.
 */
export type PrintOrientation = 'portrait' | 'landscape';

/**
 * Identifies how the ribbon's controls are aligned within the ribbon strip.
 */
export type RibbonAlignment = 'left' | 'center';

/**
 * Identifies how notifications stack in the bottom-right corner: in a column growing up the screen,
 * or receding behind the newest, which alone stays in front.
 */
export type NotificationStacking = 'upwards' | 'backwards';

/**
 * Identifies which notifications are drawn in their severity's colour: all of them, or only the
 * newest, the rest in the app's greys.
 */
export type NotificationColour = 'all' | 'newest';

/**
 * Identifies what still pops up while notifications are muted: nothing, or errors only. Muted
 * notifications are still recorded in the tray.
 */
export type MutedNotifications = 'nothing' | 'errors';

/**
 * Identifies how much of the application menu the title strip carries: not at all (`hidden`), as a
 * single button opening the whole menu (`icon`), or as a bar of its top-level sections (`full`).
 *
 * The choice is the user's on every platform rather than derived from one. Hiding suits a system that
 * draws the menu itself, the button suits a small screen, and the bar suits a large one — but which
 * of those is true is about the screen and the person, not about the operating system.
 */
export type ApplicationMenuMode = 'hidden' | 'icon' | 'full';

/**
 * Identifies how the application menu's button lays its sections out when opened: stacked as rows
 * (`vertical`) or across a strip (`horizontal`). Applies only to the button — the full menu is a bar
 * already.
 */
export type ApplicationMenuAppearance = 'vertical' | 'horizontal';

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
 * Identifies how a document well's switch between a file and its diff behaves: `tab` opens (or
 * activates) the other view as its own tab beside the current one; `swap` replaces the current tab
 * with it.
 */
export type DocumentDiffSwitch = 'tab' | 'swap';

/**
 * Identifies what happens when a document opens while a panel (an agent, say) fills the space the
 * documents would: `split-horizontal` puts the document well beside the panel; `split-vertical` puts
 * it above the panel; `collapse` collapses the panel into its tab strip, to be peeked at when wanted,
 * and gives the well the space. Closing the last document gives the panel the space back in every case.
 */
export type DocumentWellPlacement = 'split-horizontal' | 'split-vertical' | 'collapse';

/**
 * Identifies how an editor's Go to Symbol and Go to Line ask where to go (#1009): `quick-open`, a light
 * box near the top of the editor's window that filters as you type; `dialogs`, a dialog window for
 * each.
 */
export type GoToStyle = 'quick-open' | 'dialogs';

/**
 * Identifies how a diff lays out the two versions it compares: `side-by-side`, the original and the
 * changed text in two columns; `inline`, one column with removed and added lines interleaved.
 */
export type DiffLayout = 'side-by-side' | 'inline';

/**
 * Identifies when the pointer brings up a hover card: always, never, or while a modifier is held.
 * ⌘K ⌘I shows one at the caret whichever is chosen.
 */
export type ShowHoverCards = 'on' | 'off' | 'while-holding';

/**
 * Identifies when a typed bracket or quote gets its closing one: always, only before whitespace, or
 * never.
 */
export type AutoCloseBrackets = 'always' | 'before-whitespace' | 'never';

/**
 * Identifies what typing a bracket or quote over a selection wraps it in.
 */
export type AutoSurround = 'brackets-and-quotes' | 'brackets' | 'quotes' | 'never';

/**
 * Identifies how much a new line's indentation is worked out for you.
 */
export type AutoIndent = 'none' | 'keep' | 'brackets' | 'full';

/**
 * Identifies the modifier that adds a cursor when clicking: `alt` is ⌥ (Alt); `ctrl-cmd` is ⌘ (Ctrl).
 * Go to Definition takes the other.
 */
export type MultiCursorModifier = 'alt' | 'ctrl-cmd';

/**
 * Identifies what happens to Line Separator and Paragraph Separator characters found in a document.
 */
export type UnusualLineTerminators = 'ask' | 'remove' | 'ignore';

/**
 * Identifies where the completion list opens by itself as you type. ⌃Space opens it anywhere.
 */
export type QuickSuggestions = 'off' | 'code' | 'code-and-strings' | 'everywhere';

/**
 * Identifies which keys accept the completion list's focused row.
 */
export type AcceptSuggestionWith = 'enter-and-tab' | 'tab' | 'enter';

/**
 * Identifies which documents the words the completion list offers come from.
 */
export type WordBasedSuggestions = 'off' | 'this-file' | 'all-open-files';

/**
 * Identifies where snippets sit in the completion list, or that they are left out.
 */
export type SnippetSuggestions = 'top' | 'inline' | 'bottom' | 'none';

/**
 * Identifies which row of the completion list is focused when it opens.
 */
export type SuggestionSelection = 'first' | 'recently-used';

/**
 * Identifies what accepting a completion does to the text after the caret: keeps it, or replaces it.
 */
export type CompletionInsertMode = 'insert' | 'replace';

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
   * Gets a value indicating whether the language's formatter lays out the line as a closing brace, a
   * semicolon or a new line is typed (#1141).
   */
  readonly formatOnType: boolean;

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

  /**
   * Gets a value indicating whether a file's indentation is read from its content, leaving the tab
   * size and insert spaces settings to new and empty files.
   */
  readonly detectIndentation: boolean;

  /**
   * Gets which whitespace the editor draws.
   */
  readonly renderWhitespace: RenderWhitespace;

  /**
   * Gets the columns rulers are drawn at, as the user typed them; see `parseRulers`.
   */
  readonly rulers: string;

  /**
   * Gets how indentation is guided.
   */
  readonly indentGuides: IndentGuides;

  /**
   * Gets which bracket pairs get a guide.
   */
  readonly bracketPairGuides: BracketPairGuides;

  /**
   * Gets a value indicating whether the bracket matching the one at the caret is highlighted.
   */
  readonly matchBrackets: boolean;

  /**
   * Gets a value indicating whether the font's ligatures are drawn.
   */
  readonly fontLigatures: boolean;

  /**
   * Gets the shape of the cursor.
   */
  readonly cursorStyle: EditorCursorStyle;

  /**
   * Gets the width of the line cursor, in pixels.
   */
  readonly cursorWidth: number;

  /**
   * Gets a value indicating whether scrolling animates. Reduce Motion also turns it off.
   */
  readonly smoothScrolling: boolean;

  /**
   * Gets a value indicating whether the editor scrolls past the last line.
   */
  readonly scrollBeyondLastLine: boolean;

  /**
   * Gets when the fold controls show.
   */
  readonly foldingControls: FoldingControls;

  /**
   * Gets what folds the code.
   */
  readonly foldingProvider: FoldingProvider;

  /**
   * Gets which formatter runs, for a language with a built-in one.
   */
  readonly defaultFormatter: DefaultFormatter;

  /**
   * Gets what the change margin marks.
   */
  readonly changeMargin: ChangeMarginMode;

  /**
   * Gets when inlay hints show.
   */
  readonly inlayHints: InlayHintsMode;

  /**
   * Gets whether code lenses are shown at all (#1215); off, no server is asked for them.
   */
  readonly codeLens: boolean;

  /**
   * Gets whether reference-count lenses are shown (#1215).
   */
  readonly codeLensReferences: boolean;

  /**
   * Gets whether implementation-count lenses are shown (#1215).
   */
  readonly codeLensImplementations: boolean;

  /**
   * Gets whether Run Test and Debug Test lenses are shown (#1215).
   */
  readonly codeLensTests: boolean;

  /**
   * Gets whether every other kind of lens is shown (#1215).
   */
  readonly codeLensOther: boolean;

  /**
   * Gets a value indicating whether semantic tokens colour the code.
   */
  readonly semanticHighlighting: boolean;

  /**
   * Gets a value indicating whether other occurrences of the symbol at the caret are highlighted.
   */
  readonly highlightOccurrences: boolean;

  /**
   * Gets a value indicating whether other matches of the selected text are highlighted.
   */
  readonly selectionHighlight: boolean;

  /**
   * Gets a value indicating whether colour values get a swatch.
   */
  readonly colourSwatches: boolean;

  /**
   * Gets the least severe diagnostic the editor underlines.
   */
  readonly minimumDiagnosticSeverity: MinimumDiagnosticSeverity;

  /**
   * Gets a value indicating whether ⌘ or Ctrl and the mouse wheel zoom the editors.
   */
  readonly mouseWheelZoom: boolean;

  /**
   * Gets what a save formats.
   */
  readonly formatOnSave: FormatOnSave;

  /**
   * Gets a value indicating whether a save organises the imports.
   */
  readonly organiseImportsOnSave: boolean;

  /**
   * Gets a value indicating whether a save removes whitespace at the ends of lines.
   */
  readonly trimTrailingWhitespace: boolean;

  /**
   * Gets a value indicating whether a save ensures the text ends with a newline.
   */
  readonly insertFinalNewline: boolean;

  /**
   * Gets a value indicating whether a save removes blank lines after the last line of text.
   */
  readonly trimFinalNewlines: boolean;

  /**
   * Gets a value indicating whether a new UTF-8 file starts with a byte-order mark.
   */
  readonly addByteOrderMark: boolean;

  /**
   * Gets a value indicating whether pasted text is formatted.
   */
  readonly formatOnPaste: boolean;

  /**
   * Gets how long the pointer rests before a hover card shows, in milliseconds.
   */
  readonly hoverDelay: number;

  /**
   * Gets when the pointer brings up a hover card.
   */
  readonly showHoverCards: ShowHoverCards;

  /**
   * Gets where the completion list opens by itself as you type.
   */
  readonly quickSuggestions: QuickSuggestions;

  /**
   * Gets how long after typing the completion list opens by itself, in milliseconds.
   */
  readonly quickSuggestionsDelay: number;

  /**
   * Gets a value indicating whether a language's trigger characters open the completion list.
   */
  readonly suggestOnTriggerCharacters: boolean;

  /**
   * Gets which keys accept the completion list's focused row.
   */
  readonly acceptSuggestionWith: AcceptSuggestionWith;

  /**
   * Gets a value indicating whether a character a completion commits on accepts it.
   */
  readonly acceptOnCommitCharacter: boolean;

  /**
   * Gets which documents the completion list's words come from.
   */
  readonly wordBasedSuggestions: WordBasedSuggestions;

  /**
   * Gets where snippets sit in the completion list.
   */
  readonly snippetSuggestions: SnippetSuggestions;

  /**
   * Gets which row of the completion list is focused when it opens.
   */
  readonly suggestionSelection: SuggestionSelection;

  /**
   * Gets what accepting a completion does to the text after the caret.
   */
  readonly completionInsertMode: CompletionInsertMode;

  /**
   * Gets how many rows the completion list shows before it scrolls.
   */
  readonly suggestionListSize: number;

  /**
   * Gets a value indicating whether the signature card shows as you type a call.
   */
  readonly parameterHints: boolean;

  /**
   * Gets when a typed bracket or quote gets its closing one.
   */
  readonly autoCloseBrackets: AutoCloseBrackets;

  /**
   * Gets what typing a bracket or quote over a selection wraps it in.
   */
  readonly autoSurround: AutoSurround;

  /**
   * Gets how much a new line's indentation is worked out for you.
   */
  readonly autoIndent: AutoIndent;

  /**
   * Gets a value indicating whether renaming one of a linked pair, such as an HTML tag, renames both.
   */
  readonly linkedEditing: boolean;

  /**
   * Gets a value indicating whether a language server fills in a doc comment as it is begun.
   */
  readonly docCommentAutoInsert: boolean;

  /**
   * Gets the modifier that adds a cursor when clicking.
   */
  readonly multiCursorModifier: MultiCursorModifier;

  /**
   * Gets a value indicating whether the fix icon shows beside the caret's line.
   */
  readonly quickFixIndicator: boolean;

  /**
   * Gets how long things must stay still before the fix icon looks for fixes, in milliseconds.
   */
  readonly quickFixIndicatorDelay: number;

  /**
   * Gets what happens to unusual line terminators found in a document.
   */
  readonly unusualLineTerminators: UnusualLineTerminators;
}

/**
 * Defines a partial set of text editor settings, used for per-language overrides.
 */
export type PartialTextEditorSettings = Partial<TextEditorSettings>;

/**
 * Maps a Monaco language identifier to the text editor settings overridden for that language. A
 * language absent from the map, or a field absent from its entry, falls back to the global setting.
 * Each language's overrides are edited on its own page under Code › Languages.
 */
export type LanguageOverrides = Readonly<Record<string, PartialTextEditorSettings>>;

/**
 * Defines the text editor settings together with their per-language overrides.
 */
export interface TextEditorSettingsWithOverrides {
  /**
   * Gets the global default text editor settings.
   */
  readonly global: TextEditorSettings;

  /**
   * Gets the per-language overrides.
   */
  readonly languageOverrides: LanguageOverrides;
}

/**
 * Defines the application-level settings.
 */
export interface ApplicationSettings {
  /**
   * Gets how much of the application menu the title strip carries.
   */
  readonly menuMode: ApplicationMenuMode;

  /**
   * Gets how the application menu's button lays its sections out when opened.
   */
  readonly menuAppearance: ApplicationMenuAppearance;

  /**
   * Gets a value indicating whether the title strip carries the window-lock switch.
   */
  readonly showWindowLock: boolean;
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
   * Gets the background texture tiled behind the workspace's docked panes. Painted only at the full
   * graphics-acceleration level; the choice is kept, not cleared, below it (see `Display`).
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

  /**
   * Gets how a document well's switch between a file and its diff behaves.
   */
  readonly documentDiffSwitch: DocumentDiffSwitch;

  /**
   * Gets what happens when a document opens while a panel fills the documents' space.
   */
  readonly documentWellPlacement: DocumentWellPlacement;
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
   * Gets the text editor settings with their per-language overrides.
   */
  readonly textEditor: TextEditorSettingsWithOverrides;

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
  public readonly settings: Signal<AppSettings> = computed((): AppSettings => ({
    application: this.application(),
    appearance: this.appearance(),
    textEditor: this.textEditor(),
    markdownEditor: this.markdownEditor(),
    ai: this.ai(),
    workspaces: this.workspaces(),
  }));

  /**
   * Gets the application-level settings.
   */
  public readonly application: Signal<ApplicationSettings> = computed((): ApplicationSettings => ({
    menuMode: this.read('application.menuMode'),
    menuAppearance: this.read('application.menuAppearance'),
    showWindowLock: this.read('application.showWindowLock'),
  }));

  /**
   * Gets how much of the application menu the title strip carries.
   */
  public readonly applicationMenuMode: Signal<ApplicationMenuMode> =
    this.value('application.menuMode');

  /**
   * Gets how the application menu's button lays its sections out when opened.
   */
  public readonly applicationMenuAppearance: Signal<ApplicationMenuAppearance> = this.value(
    'application.menuAppearance',
  );

  /**
   * Gets a value indicating whether the title strip carries the window-lock switch.
   */
  public readonly applicationShowWindowLock: Signal<boolean> = this.value(
    'application.showWindowLock',
  );

  /**
   * Gets the appearance settings.
   */
  public readonly appearance: Signal<AppearanceSettings> = computed((): AppearanceSettings => ({
    ribbonAlignment: this.read('appearance.ribbonAlignment'),
    workspaceTexture: this.read('appearance.workspaceTexture'),
  }));

  /**
   * Gets the alignment of the ribbon's controls within the ribbon strip.
   */
  public readonly ribbonAlignment: Signal<RibbonAlignment> = this.value(
    'appearance.ribbonAlignment',
  );

  /**
   * Gets the background texture tiled behind the workspace's docked panes.
   */
  public readonly workspaceTexture: Signal<WorkspaceTexture> = this.value(
    'appearance.workspaceTexture',
  );

  /**
   * Gets the text editor settings with their per-language overrides.
   */
  public readonly textEditor: Signal<TextEditorSettingsWithOverrides> = computed(
    (): TextEditorSettingsWithOverrides => ({
      global: this.globalTextEditor(),
      languageOverrides: this.languageOverrides(),
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
   * Gets how Go to Symbol and Go to Line ask where to go (#1009). An editor-wide choice rather than a
   * per-language profile setting, so it is exposed directly rather than via {@link globalTextEditor}.
   */
  public readonly textEditorGoToStyle: Signal<GoToStyle> = this.value('textEditor.goToStyle');

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
      formatOnType: this.read('textEditor.global.formatOnType'),
      cursorBlinking: this.read('textEditor.global.cursorBlinking'),
      cursorSmoothCaretAnimation: this.read('textEditor.global.cursorSmoothCaretAnimation'),
      insertSpaces: this.read('textEditor.global.insertSpaces'),
      tabSize: this.read('textEditor.global.tabSize'),
      fontFamily: this.read('textEditor.global.fontFamily'),
      fontSize: this.read('textEditor.global.fontSize'),
      lineHeight: this.read('textEditor.global.lineHeight'),
      braceStyle: this.read('textEditor.global.braceStyle'),
      detectIndentation: this.read('textEditor.global.detectIndentation'),
      renderWhitespace: this.read('textEditor.global.renderWhitespace'),
      rulers: this.read('textEditor.global.rulers'),
      indentGuides: this.read('textEditor.global.indentGuides'),
      bracketPairGuides: this.read('textEditor.global.bracketPairGuides'),
      matchBrackets: this.read('textEditor.global.matchBrackets'),
      fontLigatures: this.read('textEditor.global.fontLigatures'),
      cursorStyle: this.read('textEditor.global.cursorStyle'),
      cursorWidth: this.read('textEditor.global.cursorWidth'),
      smoothScrolling: this.read('textEditor.global.smoothScrolling'),
      scrollBeyondLastLine: this.read('textEditor.global.scrollBeyondLastLine'),
      foldingControls: this.read('textEditor.global.foldingControls'),
      foldingProvider: this.read('textEditor.global.foldingProvider'),
      defaultFormatter: this.read('textEditor.global.defaultFormatter'),
      changeMargin: this.read('textEditor.global.changeMargin'),
      inlayHints: this.read('textEditor.global.inlayHints'),
      codeLens: this.read('textEditor.global.codeLens'),
      codeLensReferences: this.read('textEditor.global.codeLensReferences'),
      codeLensImplementations: this.read('textEditor.global.codeLensImplementations'),
      codeLensTests: this.read('textEditor.global.codeLensTests'),
      codeLensOther: this.read('textEditor.global.codeLensOther'),
      semanticHighlighting: this.read('textEditor.global.semanticHighlighting'),
      highlightOccurrences: this.read('textEditor.global.highlightOccurrences'),
      selectionHighlight: this.read('textEditor.global.selectionHighlight'),
      colourSwatches: this.read('textEditor.global.colourSwatches'),
      minimumDiagnosticSeverity: this.read('textEditor.global.minimumDiagnosticSeverity'),
      mouseWheelZoom: this.read('textEditor.global.mouseWheelZoom'),
      formatOnSave: this.read('textEditor.global.formatOnSave'),
      organiseImportsOnSave: this.read('textEditor.global.organiseImportsOnSave'),
      trimTrailingWhitespace: this.read('textEditor.global.trimTrailingWhitespace'),
      insertFinalNewline: this.read('textEditor.global.insertFinalNewline'),
      trimFinalNewlines: this.read('textEditor.global.trimFinalNewlines'),
      addByteOrderMark: this.read('textEditor.global.addByteOrderMark'),
      formatOnPaste: this.read('textEditor.global.formatOnPaste'),
      hoverDelay: this.read('textEditor.global.hoverDelay'),
      showHoverCards: this.read('textEditor.global.showHoverCards'),
      quickSuggestions: this.read('textEditor.global.quickSuggestions'),
      quickSuggestionsDelay: this.read('textEditor.global.quickSuggestionsDelay'),
      suggestOnTriggerCharacters: this.read('textEditor.global.suggestOnTriggerCharacters'),
      acceptSuggestionWith: this.read('textEditor.global.acceptSuggestionWith'),
      acceptOnCommitCharacter: this.read('textEditor.global.acceptOnCommitCharacter'),
      wordBasedSuggestions: this.read('textEditor.global.wordBasedSuggestions'),
      snippetSuggestions: this.read('textEditor.global.snippetSuggestions'),
      suggestionSelection: this.read('textEditor.global.suggestionSelection'),
      completionInsertMode: this.read('textEditor.global.completionInsertMode'),
      suggestionListSize: this.read('textEditor.global.suggestionListSize'),
      parameterHints: this.read('textEditor.global.parameterHints'),
      autoCloseBrackets: this.read('textEditor.global.autoCloseBrackets'),
      autoSurround: this.read('textEditor.global.autoSurround'),
      autoIndent: this.read('textEditor.global.autoIndent'),
      linkedEditing: this.read('textEditor.global.linkedEditing'),
      docCommentAutoInsert: this.read('textEditor.global.docCommentAutoInsert'),
      multiCursorModifier: this.read('textEditor.global.multiCursorModifier'),
      quickFixIndicator: this.read('textEditor.global.quickFixIndicator'),
      quickFixIndicatorDelay: this.read('textEditor.global.quickFixIndicatorDelay'),
      unusualLineTerminators: this.read('textEditor.global.unusualLineTerminators'),
    }),
  );

  /**
   * Gets a value that changes only when Semantic Highlighting does, globally or for any language, so
   * token providers are asked again for that and not for every other code setting.
   */
  public readonly semanticHighlightingChoices: Signal<string> = computed((): string =>
    JSON.stringify([
      this.read('textEditor.global.semanticHighlighting'),
      Object.entries(this.languageOverrides()).map(
        ([language, own]: [string, PartialTextEditorSettings]): [string, boolean | undefined] => [
          language,
          own.semanticHighlighting,
        ],
      ),
    ]),
  );

  /**
   * Gets a value that changes only when Folding Provider does, globally or for any language, so open
   * documents are folded again for that and not for every other code setting.
   */
  public readonly foldingProviderChoices: Signal<string> = computed((): string =>
    JSON.stringify([
      this.read('textEditor.global.foldingProvider'),
      Object.entries(this.languageOverrides()).map(
        ([language, own]: [string, PartialTextEditorSettings]): [
          string,
          FoldingProvider | undefined,
        ] => [language, own.foldingProvider],
      ),
    ]),
  );

  /**
   * Gets a value that changes only when Default Formatter does, globally or for any language, so the
   * language servers' formatters are added or withdrawn for that alone.
   */
  public readonly defaultFormatterChoices: Signal<string> = computed((): string =>
    JSON.stringify([
      this.read('textEditor.global.defaultFormatter'),
      Object.entries(this.languageOverrides()).map(
        ([language, own]: [string, PartialTextEditorSettings]): [
          string,
          DefaultFormatter | undefined,
        ] => [language, own.defaultFormatter],
      ),
    ]),
  );

  /**
   * Gets the per-language text editor overrides.
   */
  public readonly languageOverrides: Signal<LanguageOverrides> = this.value(
    'textEditor.languageOverrides',
  );

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
  public readonly workspaces: Signal<WorkspacesSettings> = computed((): WorkspacesSettings => ({
    fileExplorerExpandAll: this.read('workspaces.fileExplorerExpandAll'),
    documentDiffSwitch: this.read('workspaces.documentDiffSwitch'),
    documentWellPlacement: this.read('workspaces.documentWellPlacement'),
  }));

  /**
   * Gets how the File Explorer's "Expand All" behaves.
   */
  public readonly fileExplorerExpandAll: Signal<FileExplorerExpandAll> = this.value(
    'workspaces.fileExplorerExpandAll',
  );

  /**
   * Gets how a document well's switch between a file and its diff behaves.
   */
  public readonly documentDiffSwitch: Signal<DocumentDiffSwitch> = this.value(
    'workspaces.documentDiffSwitch',
  );

  /**
   * Gets what happens when a document opens while a panel fills the documents' space.
   */
  public readonly documentWellPlacement: Signal<DocumentWellPlacement> = this.value(
    'workspaces.documentWellPlacement',
  );

  /**
   * Gets the AI agent settings.
   */
  public readonly ai: Signal<AiSettings> = computed((): AiSettings => ({
    connections: this.read('ai.connections'),
    activeConnectionId: this.read('ai.activeConnectionId'),
    connectionModels: this.read('ai.connectionModels'),
    permissionPosture: this.read('ai.permissionPosture'),
    tokenCap: this.read('ai.tokenCap'),
    runTimeoutMinutes: this.read('ai.runTimeoutMinutes'),
  }));

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
   * Gets how large agent conversations render — transcript and prompt (applies to every agent view).
   */
  public readonly aiConversationTextSize: Signal<ConversationTextSize> =
    this.value('ai.conversationTextSize');

  /**
   * Gets whether a settled background task lets the agent resume the conversation to report on it.
   * When false the conversation stays idle and only the transcript note and notification are raised.
   */
  public readonly aiReportBackgroundTasks: Signal<boolean> = this.value('ai.reportBackgroundTasks');

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
   * Gets whether agents are kept off the code host's own command-line tool while a hosting plugin
   * serves the repository (#853).
   */
  public readonly aiBlockHostCommandLine: Signal<boolean> = this.value('ai.blockHostCommandLine');

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
   * Gets the most agent sessions kept live at once, or 0 for no limit.
   */
  public readonly aiMaxLiveSessions: Signal<number> = this.value('ai.maxLiveSessions');

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
   * Gets which Codex binary the Codex agent starts (bundled, system, or a custom path).
   */
  public readonly aiCodexExecutable: Signal<CodexExecutableMode> = this.value('ai.codexExecutable');

  /**
   * Gets the absolute path to the Codex binary used when {@link aiCodexExecutable} is `custom`.
   */
  public readonly aiCodexExecutablePath: Signal<string> = this.value('ai.codexExecutablePath');

  /**
   * Gets how the Mission Control agent rail scrolls a clicked agent's column into view.
   */
  public readonly missionControlTileScrollMode: Signal<TileScrollMode> = this.value(
    'missionControl.tileScrollMode',
  );

  /**
   * Gets how often the System Monitor samples the machine while showing, in milliseconds, or 0 when
   * the user paused it.
   */
  public readonly systemMonitorRefreshRate: Signal<number> = this.value(
    'systemMonitor.refreshRate',
  );

  /**
   * Gets what the Database Explorer does with a query a select action opens.
   */
  public readonly databaseSelectAction: Signal<DatabaseSelectAction> = this.value(
    'databaseExplorer.selectAction',
  );

  /**
   * Gets which rules the Database Explorer's results grid draws between its cells.
   */
  public readonly databaseGridlines: Signal<DatabaseGridlines> = this.value(
    'databaseExplorer.gridlines',
  );

  /**
   * Gets how strongly the Database Explorer's results grid draws its gridlines.
   */
  public readonly databaseGridlineTone: Signal<DatabaseGridlineTone> = this.value(
    'databaseExplorer.gridlineTone',
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
   *
   * The cross-window listener is dropped with the injector that owns it. It is a listener on the
   * global object, so it outlives this service unless it is taken away: a discarded subscription
   * leaves a dead service listening for storage events and reaching for collaborators its injector no
   * longer has.
   */
  public constructor() {
    effect((): void => {
      const overrides: SettingsOverrides = this.overrides();
      if (overrides !== this.externallyApplied) {
        this.store.set<SettingsOverrides>(SETTINGS_KEY, overrides);
      }
    });
    const unfollow: () => void = this.store.onExternalChange(SETTINGS_KEY, (): void => {
      const loaded: SettingsOverrides = this.load();
      this.externallyApplied = loaded;
      this.overrides.set(loaded);
      this.log.debug('Settings', 'Applied settings changed by another window');
    });
    inject(DestroyRef).onDestroy(unfollow);
  }

  /**
   * Gets the sparse override map: only the settings the user has changed from their defaults, which is
   * what a settings export carries.
   */
  public readonly changed: Signal<SettingsOverrides> = this.overrides.asReadonly();

  /**
   * Applies a set of imported overrides, each validated as {@link set} would. Merging keeps every
   * setting the import does not mention; replacing returns those to their defaults.
   * @param overrides The imported overrides, already restricted to known Settings-owned keys.
   * @param replace Whether settings the import does not mention go back to their defaults.
   */
  public applyOverrides(overrides: SettingsOverrides, replace: boolean): void {
    const validated: SettingsOverrides = Object.fromEntries(
      Object.entries(overrides).map(([key, value]: [string, unknown]): [string, unknown] => [
        key,
        this.validate(key as SettingsKey, value),
      ]),
    );
    this.overrides.update((current: SettingsOverrides): SettingsOverrides =>
      replace ? validated : { ...current, ...validated },
    );
    this.log.info('Settings', 'Applied imported settings', {
      count: Object.keys(validated).length,
      replace,
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
    this.overrides.update((current: SettingsOverrides): SettingsOverrides => ({
      ...current,
      [key]: validated,
    }));
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
   * Sets the background texture tiled behind the workspace's docked panes.
   * @param value The texture to apply.
   */
  public setWorkspaceTexture(value: WorkspaceTexture): void {
    this.set('appearance.workspaceTexture', value);
  }

  /**
   * Updates the global text editor settings.
   * @param updates The partial text editor settings to apply.
   */
  public updateTextEditorSettings(updates: Partial<TextEditorSettings>): void {
    this.assignSection('textEditor.global', updates);
  }

  /**
   * Overrides one text editor setting for a language.
   * @param language The Monaco language identifier.
   * @param field The text editor settings field.
   * @param value The overriding value.
   */
  public setLanguageOverride<K extends keyof TextEditorSettings>(
    language: string,
    field: K,
    value: TextEditorSettings[K],
  ): void {
    this.set(
      'textEditor.languageOverrides',
      setLanguageOverride(this.read('textEditor.languageOverrides'), language, field, value),
    );
    this.log.info('Settings', `Overrode editor setting for language`, language, field, value);
  }

  /**
   * Clears one overridden text editor setting for a language, returning it to the global value.
   * @param language The Monaco language identifier.
   * @param field The text editor settings field.
   */
  public clearLanguageOverride(language: string, field: keyof TextEditorSettings): void {
    this.set(
      'textEditor.languageOverrides',
      clearLanguageOverride(this.read('textEditor.languageOverrides'), language, field),
    );
    this.log.info('Settings', `Cleared editor setting override for language`, language, field);
  }

  /**
   * Resolves the effective text editor settings for a language: the global settings with that
   * language's overrides laid over them.
   * @param language The Monaco language identifier.
   * @returns Returns the resolved settings for the language.
   */
  public resolveSettingsForLanguage(language: string): TextEditorSettings {
    return resolveForLanguage(this.globalTextEditor(), this.languageOverrides(), language);
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
   * Sets how a document well's switch between a file and its diff behaves.
   * @param behavior The switch behavior to apply.
   */
  public setDocumentDiffSwitch(behavior: DocumentDiffSwitch): void {
    this.set('workspaces.documentDiffSwitch', behavior);
  }

  /**
   * Sets what happens when a document opens while a panel fills the documents' space.
   * @param placement The placement to apply.
   */
  public setDocumentWellPlacement(placement: DocumentWellPlacement): void {
    this.set('workspaces.documentWellPlacement', placement);
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
        : existing.map((candidate: AiConnection, i: number): AiConnection =>
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
