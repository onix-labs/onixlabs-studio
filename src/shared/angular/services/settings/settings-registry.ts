import type { VcsPullMode, VcsSignCommits } from '@shared/api/version-control-protocol';
import type { CloneLayout } from '@shared/api/clone-channels';
import { encodingLabel, TEXT_ENCODINGS, type TextEncoding } from '@shared/api/text-encodings';
import type { RunPresentation } from '@shared/api/studio';
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
  ConfirmExternalLinks,
  CornerStyle,
  QuitWhenLastWindowCloses,
  WindowSizeOnLaunch,
} from '@shared/api/startup-settings';
import type {
  ApplicationMenuAppearance,
  ApplicationMenuMode,
  AcceptSuggestionWith,
  AutoCloseBrackets,
  AutoIndent,
  AutoSurround,
  BraceStyle,
  CompletionInsertMode,
  QuickSuggestions,
  ShowHoverCards,
  SnippetSuggestions,
  SuggestionSelection,
  WordBasedSuggestions,
  BracketPairGuides,
  ChangeMarginMode,
  EditorCursorStyle,
  FormatOnSave,
  DefaultFormatter,
  FoldingControls,
  FoldingProvider,
  IndentGuides,
  InlayHintsMode,
  MinimumDiagnosticSeverity,
  MultiCursorModifier,
  RenderWhitespace,
  UnusualLineTerminators,
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
  PrintOrientation,
  PrintPaperSize,
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
 * Names how dates read in the commit history.
 */
export type HistoryDateFormat = 'relative' | 'absolute' | 'both';

/**
 * Names when an edited document saves itself: never, a moment after typing stops, or when the
 * editor loses focus.
 */
export type AutoSaveMode = 'off' | 'delay' | 'focus';

/**
 * Names what happens to an unedited document whose file changes on disk: it reloads without a word,
 * the user is asked, or the change is ignored. An edited document always asks.
 */
export type ReloadOnDiskChange = 'silent' | 'ask' | 'ignore';

/**
 * Names the line ending a new document starts with: LF, CRLF, or the system's own (CRLF on Windows,
 * LF elsewhere).
 */
export type DefaultEndOfLine = 'lf' | 'crlf' | 'system';

/**
 * Names the shape of a terminal's cursor.
 */
export type TerminalCursorStyle = 'block' | 'bar' | 'underline';

/**
 * Names the view a generated-code panel starts on: the compiler's static output, or the JIT's.
 */
export type GeneratedCodeView = 'static' | 'jit';

/**
 * Names when a workspace's language server starts: as the workspace opens (for the project kinds that
 * have one), or only once the first file it serves is opened.
 */
export type LspStartMode = 'open' | 'first-file';

/**
 * Names how a terminal draws: on the GPU (WebGL), where Graphics Acceleration allows, or with the
 * standard renderer.
 */
export type TerminalRenderer = 'gpu' | 'standard';

/**
 * Names what a right-click in a terminal does: open its menu, paste, or select the word under it.
 */
export type TerminalRightClick = 'menu' | 'paste' | 'select-word';

/**
 * Names how a link in a terminal opens: with ⌘ (Ctrl elsewhere) held, with a plain click, or not at
 * all.
 */
export type TerminalLinkOpening = 'modifier' | 'click' | 'off';

/**
 * Names what a terminal does when a program rings its bell.
 */
export type TerminalBell = 'none' | 'sound' | 'visual';

/**
 * Names when closing a terminal asks first: every time, only while a program runs in it, or never.
 */
export type TerminalConfirmClose = 'always' | 'running' | 'never';

/**
 * Names what happens to a terminal when its shell exits: it stays open with its output, it closes, or
 * it closes only when the shell exited cleanly (code 0).
 */
export type TerminalOnShellExit = 'keep' | 'close' | 'close-if-clean';

/**
 * Holds the Font Family value that follows Code › Appearance's font.
 */
export const TERMINAL_FONT_SAME_AS_CODE: string = 'same-as-code';

/**
 * Identifies how an explorer orders the entries of a folder.
 */
export type ExplorerSortOrder = 'folders-first' | 'files-first' | 'mixed';

/**
 * Identifies how an explorer's row opens its file: one click, or two.
 */
export type ExplorerOpenFilesWith = 'single' | 'double';

/**
 * Identifies what happens to edited files when a run or build starts.
 */
export type SaveBeforeRun = 'never' | 'ask' | 'always';

/**
 * Identifies what Run does while its configuration is already running.
 */
export type WhenConfigurationRunning = 'ask' | 'restart' | 'run-another';

/**
 * Identifies what a build does while another is running.
 */
export type WhenBuildRunning = 'ask' | 'restart' | 'queue';

/**
 * Identifies which terminal a run uses: the configuration's own, cleared or carrying on from the last
 * run, or a new one each time.
 */
export type RunTerminalChoice = 'reuse-clear' | 'reuse-keep' | 'new';

/**
 * Identifies when a run brings its terminal forward.
 */
export type RevealTerminalOnRun = 'always' | 'failure' | 'never';

/**
 * The languages Monaco formats itself (the TypeScript, JSON, CSS and HTML workers), which are the ones
 * Default Formatter chooses for: every other language has its language server's formatter or none.
 */
export const BUILT_IN_FORMATTER_LANGUAGES: ReadonlySet<string> = new Set<string>([
  'typescript',
  'javascript',
  'json',
  'css',
  'scss',
  'less',
  'html',
]);

/**
 * Names whether Studio asks first or acts on its own when a housekeeping setting comes due.
 */
export type AskOrAutomatic = 'ask' | 'automatic';

/**
 * Names the reasoning effort a new conversation starts at: the provider's own default, or a level.
 */
export type DefaultReasoningEffort = 'provider' | 'low' | 'medium' | 'high';

/**
 * Names the key that sends an agent message; the other two insert a new line.
 */
export type SendMessageWith = 'enter' | 'mod-enter' | 'shift-enter';

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
 * Names how much larger than body text Markdown's headings are set.
 */
export type MarkdownHeadingScale = 'compact' | 'standard' | 'large';

/**
 * Names when a link in a Markdown document is underlined.
 */
export type MarkdownUnderlineLinks = 'hover' | 'always';

/**
 * Names the theme a Mermaid diagram is drawn in; automatic follows Studio's light or dark theme.
 */
export type MarkdownMermaidTheme = 'automatic' | 'neutral' | 'forest' | 'base';

/**
 * Names where an image pasted or dropped into a Markdown document goes: into the document itself,
 * beside its file, or into a folder beside its file.
 */
export type MarkdownPastedImageStorage = 'embed' | 'beside' | 'folder';

/**
 * Names how a path to a local image is written into a Markdown document.
 */
export type MarkdownInsertedImagePaths = 'relative' | 'absolute';

/**
 * Names what opens a link in a Markdown document: a click with the command modifier, a plain click,
 * or only the link's own tooltip.
 */
export type MarkdownOpenLinks = 'modifier' | 'click' | 'tooltip';

/**
 * Names how a raw HTML block in a Markdown document shows: rendered through the sanitiser, or as
 * text.
 */
export type MarkdownRenderHtmlBlocks = 'safe' | 'text';

/**
 * Names what a Markdown math block shows while the caret is elsewhere.
 */
export type MarkdownMathBlocks = 'preview' | 'source';

/**
 * Names how text on the clipboard is pasted into a Markdown document.
 */
export type MarkdownDefaultPaste = 'markdown' | 'plain' | 'code';

/**
 * Names how much of a rich clipboard's formatting a paste into a Markdown document keeps.
 */
export type MarkdownRichPaste = 'keep' | 'basic' | 'none';

/**
 * Names the editor a Markdown file opens in: the visual editor, or the code editor on its source.
 */
export type MarkdownOpenFilesIn = 'visual' | 'source';

/**
 * Names whether review asks for the comma before the last item of a list, flags it, or says nothing.
 */
export type MarkdownSerialComma = 'require' | 'forbid' | 'off';

/**
 * Names the pitch Markdown is read aloud in.
 */
export type ReadAloudPitch = 'low' | 'normal' | 'high';

/**
 * Names what is highlighted in the document as it is read aloud.
 */
export type ReadAlongHighlight = 'word' | 'sentence' | 'none';

/**
 * Names how large an image first shows.
 */
export type ImageZoomOnOpen = 'fit' | 'actual';

/**
 * Names what an image is shown against: a checkerboard that makes transparency visible, a plain light
 * or dark ground, or the theme's own background.
 */
export type ImageDefaultBackground = 'checker' | 'light' | 'dark' | 'theme';

/**
 * Names the size of the checkerboard behind an image.
 */
export type ImageCheckerboardSize = 'small' | 'medium' | 'large';

/**
 * Names how a scaled image is drawn.
 */
export type ImageSmoothing = 'automatic' | 'smooth' | 'sharp';

/**
 * Names what the mouse wheel does over an image.
 */
export type ImageMouseWheel = 'scroll' | 'zoom';

/**
 * Names what saving an edited image in a format that can't be written back does.
 */
export type ImageFallbackSaveFormat = 'png' | 'webp' | 'ask';

/**
 * Names where an image from a workspace opens.
 */
export type ImageOpenIn = 'workspace' | 'tab';

/**
 * Names how an SVG file opens.
 */
export type ImageOpenSvgAs = 'image' | 'code';

/**
 * Names the case hex is written in.
 */
export type BinaryHexCase = 'upper' | 'lower';

/**
 * Names how the binary editor's text column reads bytes.
 */
export type BinaryTextEncoding = 'ascii' | 'latin1' | 'utf8';

/**
 * Names how the binary editor writes a row's offset.
 */
export type BinaryAddressFormat = 'hex-split' | 'hex' | 'decimal';

/**
 * Names whether typing in the binary editor replaces bytes or adds them.
 */
export type BinaryTypingMode = 'overwrite' | 'insert';

/**
 * Names where an executable opens.
 */
export type BinaryJumpOnOpen = 'entry' | 'start';

/**
 * Names how the binary editor's Copy writes bytes.
 */
export type BinaryCopyFormat = 'hex' | '0x' | 'c-array' | 'base64' | 'text';

/**
 * Names the byte order the Inspector starts with.
 */
export type BinaryInspectorEndian = 'little' | 'big';

/**
 * Names whether the Inspector starts with signed or unsigned integers.
 */
export type BinaryInspectorSign = 'signed' | 'unsigned';

/**
 * Names what a double-click in the binary editor selects.
 */
export type BinaryDoubleClick = 'instruction' | 'byte';

/**
 * Names whose certificates the API Explorer accepts without verifying them.
 */
export type ApiAcceptSelfSigned = 'never' | 'localhost' | 'always';

/**
 * Names how the API Explorer's requests reach their servers.
 */
export type ApiProxyMode = 'none' | 'system' | 'custom';

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
  readonly 'application.spellChecking': boolean;
  readonly 'application.spellCheckingLanguages': readonly string[];
  readonly 'spelling.personalDictionary': readonly string[];

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
  readonly 'privacy.confirmExternalLinks': ConfirmExternalLinks;
  readonly 'notifications.maxToasts': number;
  readonly 'notifications.rememberMute': boolean;
  readonly 'notifications.errorsStay': boolean;
  readonly 'notifications.desktopErrors': boolean;
  readonly 'notifications.agentFinished': FinishNotifications;
  readonly 'notifications.runFinished': FinishNotifications;

  readonly 'printing.paperSize': PrintPaperSize;
  readonly 'printing.orientation': PrintOrientation;
  readonly 'printing.backgroundColours': boolean;
  readonly 'printing.syntaxColours': boolean;
  readonly 'printing.lineNumbers': boolean;
  readonly 'printing.fontSize': number;
  readonly 'printing.headerAndFooter': boolean;
  readonly 'printing.openPdfAfterExport': boolean;

  readonly 'workspaces.fileExplorerExpandAll': FileExplorerExpandAll;
  readonly 'workspaces.documentDiffSwitch': DocumentDiffSwitch;
  readonly 'workspaces.documentWellPlacement': DocumentWellPlacement;
  readonly 'workspaces.addStudioUserFileToGitignore': boolean;
  readonly 'workspaces.showErrorSquiggles': boolean;
  readonly 'workspaces.sortOrder': ExplorerSortOrder;
  readonly 'workspaces.openFilesWith': ExplorerOpenFilesWith;
  readonly 'workspaces.confirmBeforeDeleting': boolean;
  readonly 'workspaces.moveToTrash': boolean;
  readonly 'workspaces.projectScanDepth': number;
  readonly 'workspaces.searchMaximumResults': number;
  readonly 'workspaces.searchTimeout': number;
  readonly 'workspaces.searchMaximumFileSize': number;
  readonly 'workspaces.followSymbolicLinks': boolean;
  readonly 'workspaces.problemsShown': number;
  readonly 'workspaces.showDebugPanelsOnStart': boolean;
  readonly 'workspaces.askWhereToCreate': boolean;
  readonly 'workspaces.sendFirstMessageAutomatically': boolean;
  readonly 'workspaces.planBeforeBuilding': boolean;
  readonly 'workspaces.saveBeforeRun': SaveBeforeRun;
  readonly 'workspaces.whenConfigurationRunning': WhenConfigurationRunning;
  readonly 'workspaces.whenBuildRunning': WhenBuildRunning;
  readonly 'workspaces.runTerminal': RunTerminalChoice;
  readonly 'workspaces.revealTerminalOnRun': RevealTerminalOnRun;
  readonly 'workspaces.newConfigurationsShowOutputIn': RunPresentation;
  readonly 'workspaces.stopGracePeriod': number;
  readonly 'workspaces.revealDebugOutputOnStart': boolean;
  readonly 'workspaces.outputScrollbackLines': number;

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
  readonly 'textEditor.global.detectIndentation': boolean;
  readonly 'textEditor.global.formatOnSave': FormatOnSave;
  readonly 'textEditor.global.organiseImportsOnSave': boolean;
  readonly 'textEditor.global.trimTrailingWhitespace': boolean;
  readonly 'textEditor.global.insertFinalNewline': boolean;
  readonly 'textEditor.global.trimFinalNewlines': boolean;
  readonly 'textEditor.global.addByteOrderMark': boolean;
  readonly 'textEditor.global.formatOnPaste': boolean;
  readonly 'textEditor.honourEditorConfig': boolean;
  readonly 'textEditor.global.renderWhitespace': RenderWhitespace;
  readonly 'textEditor.global.rulers': string;
  readonly 'textEditor.global.indentGuides': IndentGuides;
  readonly 'textEditor.global.bracketPairGuides': BracketPairGuides;
  readonly 'textEditor.global.matchBrackets': boolean;
  readonly 'textEditor.global.fontLigatures': boolean;
  readonly 'textEditor.global.cursorStyle': EditorCursorStyle;
  readonly 'textEditor.global.cursorWidth': number;
  readonly 'textEditor.global.smoothScrolling': boolean;
  readonly 'textEditor.global.scrollBeyondLastLine': boolean;
  readonly 'textEditor.global.foldingControls': FoldingControls;
  readonly 'textEditor.global.foldingProvider': FoldingProvider;
  readonly 'textEditor.global.defaultFormatter': DefaultFormatter;
  readonly 'textEditor.global.changeMargin': ChangeMarginMode;
  readonly 'textEditor.global.inlayHints': InlayHintsMode;
  readonly 'textEditor.global.semanticHighlighting': boolean;
  readonly 'textEditor.global.highlightOccurrences': boolean;
  readonly 'textEditor.global.selectionHighlight': boolean;
  readonly 'textEditor.global.colourSwatches': boolean;
  readonly 'textEditor.global.minimumDiagnosticSeverity': MinimumDiagnosticSeverity;
  readonly 'textEditor.global.mouseWheelZoom': boolean;
  readonly 'textEditor.zoom': number;
  readonly 'textEditor.global.hoverDelay': number;
  readonly 'textEditor.global.showHoverCards': ShowHoverCards;
  readonly 'textEditor.global.quickSuggestions': QuickSuggestions;
  readonly 'textEditor.global.quickSuggestionsDelay': number;
  readonly 'textEditor.global.suggestOnTriggerCharacters': boolean;
  readonly 'textEditor.global.acceptSuggestionWith': AcceptSuggestionWith;
  readonly 'textEditor.global.acceptOnCommitCharacter': boolean;
  readonly 'textEditor.global.wordBasedSuggestions': WordBasedSuggestions;
  readonly 'textEditor.global.snippetSuggestions': SnippetSuggestions;
  readonly 'textEditor.global.suggestionSelection': SuggestionSelection;
  readonly 'textEditor.global.completionInsertMode': CompletionInsertMode;
  readonly 'textEditor.global.suggestionListSize': number;
  readonly 'textEditor.global.autoCloseBrackets': AutoCloseBrackets;
  readonly 'textEditor.global.autoSurround': AutoSurround;
  readonly 'textEditor.global.autoIndent': AutoIndent;
  readonly 'textEditor.global.linkedEditing': boolean;
  readonly 'textEditor.global.docCommentAutoInsert': boolean;
  readonly 'textEditor.global.multiCursorModifier': MultiCursorModifier;
  readonly 'textEditor.global.quickFixIndicator': boolean;
  readonly 'textEditor.global.quickFixIndicatorDelay': number;
  readonly 'textEditor.global.unusualLineTerminators': UnusualLineTerminators;
  readonly 'textEditor.global.parameterHints': boolean;
  readonly 'textEditor.goToStyle': GoToStyle;
  readonly 'textEditor.goToSymbolMatching': 'contains' | 'fuzzy';
  readonly 'textEditor.seedFindFrom': 'selection' | 'selection-or-word';
  readonly 'textEditor.confirmMultiFileRename': boolean;
  readonly 'textEditor.saveAfterRename': boolean;
  readonly 'textEditor.diffLayout': DiffLayout;
  readonly 'textEditor.diffIgnoreWhitespace': boolean;
  readonly 'textEditor.diffCollapseUnchanged': boolean;
  readonly 'textEditor.autoSave': AutoSaveMode;
  readonly 'textEditor.reloadOnDiskChange': ReloadOnDiskChange;
  readonly 'textEditor.largeFileSizeMb': number;
  readonly 'textEditor.largeFileLineThreshold': number;
  readonly 'textEditor.defaultLanguage': string;
  readonly 'textEditor.defaultEol': DefaultEndOfLine;
  readonly 'textEditor.defaultEncoding': TextEncoding;
  readonly 'textEditor.autoDetectEncoding': boolean;
  readonly 'textEditor.generatedCodeView': GeneratedCodeView;
  readonly 'lsp.restartTries': number;
  readonly 'lsp.idleStopMinutes': number;
  readonly 'lsp.startMode': LspStartMode;
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
  readonly 'markdownEditor.paragraphLineHeight': number;
  readonly 'markdownEditor.headingScale': MarkdownHeadingScale;
  readonly 'markdownEditor.underlineLinks': MarkdownUnderlineLinks;
  readonly 'markdownEditor.maxImageWidth': number;
  readonly 'markdownEditor.cursorBlinking': CursorBlinkingStyle;
  readonly 'markdownEditor.codeBlockLineNumbers': boolean;
  readonly 'markdownEditor.mermaidTheme': MarkdownMermaidTheme;
  readonly 'markdownEditor.mermaidBodyFont': boolean;
  readonly 'markdownEditor.pastedImageStorage': MarkdownPastedImageStorage;
  readonly 'markdownEditor.pastedImageFolder': string;
  readonly 'markdownEditor.insertedImagePaths': MarkdownInsertedImagePaths;
  readonly 'markdownEditor.openLinks': MarkdownOpenLinks;
  readonly 'markdownEditor.renderHtmlBlocks': MarkdownRenderHtmlBlocks;
  readonly 'markdownEditor.convertEmoji': boolean;
  readonly 'markdownEditor.convertAlerts': boolean;
  readonly 'markdownEditor.subSuperscriptShortcuts': boolean;
  readonly 'markdownEditor.colourSwatches': boolean;
  readonly 'markdownEditor.floatingToolbar': boolean;
  readonly 'markdownEditor.blockHandles': boolean;
  readonly 'markdownEditor.slashMenu': boolean;
  readonly 'markdownEditor.mathBlocks': MarkdownMathBlocks;
  readonly 'markdownEditor.smartPunctuation': boolean;
  readonly 'markdownEditor.undoHistory': number;
  readonly 'markdownEditor.defaultPaste': MarkdownDefaultPaste;
  readonly 'markdownEditor.richPaste': MarkdownRichPaste;
  readonly 'markdownEditor.openFilesIn': MarkdownOpenFilesIn;
  readonly 'markdownEditor.outlineDepth': number;
  readonly 'markdownEditor.checkSpelling': boolean;
  readonly 'markdownEditor.reviewRepeatedWord': boolean;
  readonly 'markdownEditor.reviewPassiveVoice': boolean;
  readonly 'markdownEditor.reviewArticleAgreement': boolean;
  readonly 'markdownEditor.reviewWeakIntensifier': boolean;
  readonly 'markdownEditor.reviewSerialComma': MarkdownSerialComma;
  readonly 'markdownEditor.readAloudVoice': string;
  readonly 'markdownEditor.enhancedVoicesOnly': boolean;
  readonly 'markdownEditor.readAloudSpeed': number;
  readonly 'markdownEditor.readAloudPitch': ReadAloudPitch;
  readonly 'markdownEditor.readAloudVolume': number;
  readonly 'markdownEditor.readAlongHighlight': ReadAlongHighlight;
  readonly 'markdownEditor.followSpokenWord': boolean;
  readonly 'markdownEditor.readingSpeed': number;

  readonly 'imageViewer.zoomOnOpen': ImageZoomOnOpen;
  readonly 'imageViewer.enlargeSmallImages': boolean;
  readonly 'imageViewer.defaultBackground': ImageDefaultBackground;
  readonly 'imageViewer.checkerboardSize': ImageCheckerboardSize;
  readonly 'imageViewer.smoothing': ImageSmoothing;
  readonly 'imageViewer.mouseWheel': ImageMouseWheel;
  readonly 'imageViewer.undoHistory': number;
  readonly 'imageViewer.saveQuality': number;
  readonly 'imageViewer.fallbackSaveFormat': ImageFallbackSaveFormat;
  readonly 'imageViewer.openIn': ImageOpenIn;
  readonly 'imageViewer.openSvgAs': ImageOpenSvgAs;

  readonly 'binaryEditor.bytesPerRow': number;
  readonly 'binaryEditor.byteGrouping': number;
  readonly 'binaryEditor.hexCase': BinaryHexCase;
  readonly 'binaryEditor.showTextColumn': boolean;
  readonly 'binaryEditor.textEncoding': BinaryTextEncoding;
  readonly 'binaryEditor.addressFormat': BinaryAddressFormat;
  readonly 'binaryEditor.typingMode': BinaryTypingMode;
  readonly 'binaryEditor.openReadOnly': boolean;
  readonly 'binaryEditor.jumpOnOpen': BinaryJumpOnOpen;
  readonly 'binaryEditor.copyFormat': BinaryCopyFormat;
  readonly 'binaryEditor.inspectorEndian': BinaryInspectorEndian;
  readonly 'binaryEditor.inspectorSign': BinaryInspectorSign;
  readonly 'binaryEditor.doubleClickSelects': BinaryDoubleClick;
  readonly 'binaryEditor.loadSymbolFiles': boolean;
  readonly 'binaryEditor.decodeLimit': number;

  readonly 'apiExplorer.requestTimeoutSeconds': number;
  readonly 'apiExplorer.followRedirects': boolean;
  readonly 'apiExplorer.maxResponseMib': number;
  readonly 'apiExplorer.acceptSelfSigned': ApiAcceptSelfSigned;
  readonly 'apiExplorer.proxyMode': ApiProxyMode;
  readonly 'apiExplorer.proxyAddress': string;
  readonly 'apiExplorer.proxyBypass': string;
  readonly 'apiExplorer.historySize': number;
  readonly 'apiExplorer.keepHistory': boolean;
  readonly 'apiExplorer.prettyPrintJson': boolean;
  readonly 'apiExplorer.wrapResponseBody': boolean;
  readonly 'apiExplorer.confirmDelete': boolean;
  readonly 'apiExplorer.sampleContent': boolean;

  readonly 'plugins.notifyUpdates': boolean;
  readonly 'plugins.showUnsupported': boolean;
  readonly 'plugins.suggestPlugins': boolean;
  readonly 'plugins.dismissedSuggestions': readonly string[];
  readonly 'terminal.defaultShell': string;
  readonly 'terminal.fontFamily': string;
  readonly 'terminal.fontSize': number;
  readonly 'terminal.scrollback': number;
  readonly 'terminal.cursorStyle': TerminalCursorStyle;
  readonly 'terminal.cursorBlink': boolean;
  readonly 'terminal.renderer': TerminalRenderer;
  readonly 'terminal.optionAsMeta': boolean;
  readonly 'terminal.copyOnSelect': boolean;
  readonly 'terminal.rightClick': TerminalRightClick;
  readonly 'terminal.warnMultiLinePaste': boolean;
  readonly 'terminal.linkOpening': TerminalLinkOpening;
  readonly 'terminal.bell': TerminalBell;
  readonly 'terminal.shellArguments': string;
  readonly 'terminal.loginShell': boolean;
  readonly 'terminal.confirmClose': TerminalConfirmClose;
  readonly 'terminal.onShellExit': TerminalOnShellExit;

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
  readonly 'ai.requireOsSandbox': boolean;
  readonly 'ai.autoAllowSandboxedShell': boolean;
  readonly 'ai.allowedWritePaths': readonly string[];
  readonly 'ai.deniedWritePaths': readonly string[];
  readonly 'ai.allowedNetworkLocations': readonly string[];
  readonly 'ai.deniedNetworkLocations': readonly string[];
  readonly 'ai.tokenCap': number;
  readonly 'ai.runTimeoutMinutes': number;
  readonly 'ai.agentSessionLifetime': number;
  readonly 'ai.agentShell': string;
  readonly 'ai.maxLiveSessions': number;
  readonly 'ai.defaultReasoningEffort': DefaultReasoningEffort;
  readonly 'ai.maxStepsPerTurn': number;
  readonly 'versionControl.autoFetchMinutes': number;
  readonly 'versionControl.fetchOnLoad': boolean;
  readonly 'versionControl.defaultRemote': string;
  readonly 'versionControl.pruneOnFetch': boolean;
  readonly 'versionControl.pullMode': VcsPullMode;
  readonly 'versionControl.setUpstreamOnPush': AskOrAutomatic;
  readonly 'versionControl.networkTimeoutMinutes': number;
  readonly 'versionControl.signCommits': VcsSignCommits;
  readonly 'versionControl.signOff': boolean;
  readonly 'versionControl.runCommitHooks': boolean;
  readonly 'versionControl.stashIncludesUntracked': boolean;
  readonly 'versionControl.defaultBranchName': string;
  readonly 'versionControl.includeUntrackedInCommit': boolean;
  readonly 'versionControl.checkOutNewBranch': boolean;
  readonly 'versionControl.historyDateFormat': HistoryDateFormat;
  readonly 'versionControl.historyPageSize': number;
  readonly 'versionControl.hostingRefreshSeconds': number;
  readonly 'versionControl.hostingListSize': number;
  readonly 'versionControl.ciRunsScope': 'branch' | 'all';
  readonly 'versionControl.pullRequestAndIssueStates': 'open' | 'all';
  readonly 'versionControl.askWhereToClone': boolean;
  readonly 'versionControl.cloneLayout': 'ask' | CloneLayout;
  readonly 'versionControl.cloneProtocol': 'https' | 'ssh';
  readonly 'versionControl.cloneSubmodules': boolean;
  readonly 'versionControl.shallowClone': 'full' | 'latest';
  readonly 'ai.autoCompactThreshold': number;
  readonly 'ai.autoCompactMode': AskOrAutomatic;
  readonly 'ai.deleteConversationsAfterDays': number;
  readonly 'ai.deleteConversationsMode': AskOrAutomatic;
  readonly 'ai.sendMessageWith': SendMessageWith;
  readonly 'ai.maxImagesPerMessage': number;
  readonly 'ai.maxImageSizeMb': number;
  readonly 'ai.expandToolCalls': boolean;
  readonly 'ai.expandThinking': boolean;
  readonly 'ai.confirmDeleteConversations': boolean;
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
/**
 * Holds how the platform's command modifier is written in an option label: ⌘ on macOS, Ctrl elsewhere.
 */
const MOD_LABEL: string =
  typeof window !== 'undefined' && window.host?.platform === 'darwin' ? '⌘' : 'Ctrl+';

/**
 * Holds how a click with the command modifier is written in an option label: ⌘-click on macOS,
 * Ctrl-click elsewhere.
 */
const MODIFIER_CLICK: string =
  typeof window !== 'undefined' && window.host?.platform === 'darwin' ? '⌘-click' : 'Ctrl-click';

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
        key: 'application.cornerStyle',
        title: 'Corner Style',
        description:
          'The shape of corners across the interface. Automatic draws squircles when Graphics ' +
          'Acceleration is at Full, and rounded corners below it; Squircle is only offered at Full.',
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
          'Closing the window closes its tabs and keeps Studio running in the Dock, which opens ' +
          'the welcome screen again; or it quits Studio.',
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
          'Show the switch at the start of the title strip that pins the window in place. It ' +
          'steps away in full screen, where the window cannot be moved. Turning this off also ' +
          'releases the lock.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'application.spellChecking',
        title: 'Spell Checking',
        description:
          'Underline misspelled words in text boxes, and check spelling in Markdown review, in the ' +
          'languages below.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'application.spellCheckingLanguages',
        title: 'Spell Checking Languages',
        description:
          'The languages checked together, such as English (UK) and English (US). None chosen ' +
          'checks the system language.',
        control: { kind: 'custom', component: 'spell-checking-languages' },
        default: [],
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
    // How code and Markdown documents print and export to PDF; each keeps its own Print Margins.
    id: 'printing',
    label: 'Printing',
    settings: [
      {
        key: 'printing.paperSize',
        title: 'Paper Size',
        description:
          'The paper documents print and export on. System uses Letter in regions that use it, ' +
          'such as the US and Canada, and A4 everywhere else.',
        control: {
          kind: 'select',
          options: [
            { value: 'system', label: 'System' },
            { value: 'a4', label: 'A4' },
            { value: 'letter', label: 'Letter' },
            { value: 'legal', label: 'Legal' },
            { value: 'a3', label: 'A3' },
          ],
        },
        default: 'system',
      },
      {
        key: 'printing.orientation',
        title: 'Orientation',
        description: 'Which way up the page is laid out.',
        control: {
          kind: 'select',
          options: [
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ],
        },
        default: 'portrait',
      },
      {
        key: 'printing.backgroundColours',
        title: 'Print Background Colours',
        description:
          'Print the shading behind code blocks, tables and highlights. Off saves ink and prints ' +
          'text on plain white.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'printing.syntaxColours',
        title: 'Print Syntax Colours',
        description:
          'Colour printed code by its syntax, in Markdown code blocks too. Off prints code in black.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'printing.lineNumbers',
        title: 'Print Line Numbers',
        description: 'Number each line down the left of a printed code document.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'printing.fontSize',
        title: 'Print Font Size',
        description: 'The size printed code is set in. The font is the one Code uses.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '8', label: '8 pt' },
            { value: '9', label: '9 pt' },
            { value: '10', label: '10 pt' },
            { value: '11', label: '11 pt' },
            { value: '12', label: '12 pt' },
          ],
        },
        default: 10,
      },
      {
        key: 'printing.headerAndFooter',
        title: 'Header and Footer',
        description:
          'Print the file name and date at the top of each page, and the page number at the bottom.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'printing.openPdfAfterExport',
        title: 'Open PDF After Export',
        description: 'Open an exported PDF in the default PDF viewer once it is written.',
        control: { kind: 'toggle' },
        default: true,
      },
    ],
  },
  {
    // The File Explorer and the Solution Explorer alike.
    id: 'workspaces-explorers',
    label: 'Explorers',
    settings: [
      {
        key: 'workspaces.showErrorSquiggles',
        title: 'Show Error Squiggles',
        description: 'Underline the name of a file with an error, and the folders above it.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'workspaces.sortOrder',
        title: 'Sort Order',
        description: 'How the entries of a folder are ordered.',
        control: {
          kind: 'select',
          options: [
            { value: 'folders-first', label: 'Folders First' },
            { value: 'files-first', label: 'Files First' },
            { value: 'mixed', label: 'Mixed' },
          ],
        },
        default: 'folders-first',
      },
      {
        key: 'workspaces.openFilesWith',
        title: 'Open Files With',
        description: 'How a file opens from an explorer.',
        control: {
          kind: 'select',
          options: [
            { value: 'single', label: 'Single Click' },
            { value: 'double', label: 'Double Click' },
          ],
        },
        default: 'double',
      },
      {
        key: 'workspaces.confirmBeforeDeleting',
        title: 'Confirm Before Deleting',
        description:
          'Ask before moving files and folders to the Trash. Deleting permanently always asks.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'workspaces.moveToTrash',
        title: 'Move to Trash',
        description:
          'Move deleted files and folders to the Trash. Off deletes them permanently, after a stronger confirmation.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'workspaces.projectScanDepth',
        title: 'Project Scan Depth',
        description:
          'How many folder levels are searched for .NET projects in a folder with no solution. Takes effect the next time a folder is opened.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: '1 level' },
            { value: '2', label: '2 levels' },
            { value: '3', label: '3 levels' },
            { value: '5', label: '5 levels' },
          ],
        },
        default: 2,
      },
    ],
  },
  {
    id: 'workspaces-search',
    label: 'Search and Problems',
    settings: [
      {
        key: 'workspaces.searchMaximumResults',
        title: 'Search Maximum Results',
        description: 'The most matches a search returns across all files.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1000', label: '1,000' },
            { value: '5000', label: '5,000' },
            { value: '10000', label: '10,000' },
            { value: '20000', label: '20,000' },
          ],
        },
        default: 5000,
      },
      {
        key: 'workspaces.searchTimeout',
        title: 'Search Timeout',
        description: 'How long a search may run before it stops with what it has found.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '30', label: '30 seconds' },
            { value: '60', label: '1 minute' },
            { value: '300', label: '5 minutes' },
            { value: '0', label: 'No limit' },
          ],
        },
        default: 60,
      },
      {
        key: 'workspaces.searchMaximumFileSize',
        title: 'Search Maximum File Size',
        description: 'Files larger than this are left out of a search.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: '1 MB' },
            { value: '10', label: '10 MB' },
            { value: '50', label: '50 MB' },
            { value: '0', label: 'No limit' },
          ],
        },
        default: 10,
      },
      {
        key: 'workspaces.followSymbolicLinks',
        title: 'Follow Symbolic Links',
        description: 'Search through symbolic links, including into folders outside the workspace.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'workspaces.problemsShown',
        title: 'Problems Shown',
        description:
          'The most problems the Error List shows at once. Its counts always cover them all.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '500', label: '500' },
            { value: '1000', label: '1,000' },
            { value: '5000', label: '5,000' },
            { value: '0', label: 'No limit' },
          ],
        },
        default: 1000,
      },
    ],
  },
  {
    id: 'workspaces-run',
    label: 'Run and Debug',
    settings: [
      {
        key: 'workspaces.saveBeforeRun',
        title: 'Save Documents Before Run or Build',
        description:
          'What happens to edited files when a run or build starts. Files never saved yet are left alone.',
        control: {
          kind: 'select',
          options: [
            { value: 'never', label: 'Never' },
            { value: 'ask', label: 'Ask' },
            { value: 'always', label: 'Always' },
          ],
        },
        default: 'always',
      },
      {
        key: 'workspaces.whenConfigurationRunning',
        title: 'When a Configuration Is Already Running',
        description:
          'What Run does while its configuration is running. Only one debug session runs at a time, so Run Another asks instead for one.',
        control: {
          kind: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'restart', label: 'Restart' },
            { value: 'run-another', label: 'Run Another' },
          ],
        },
        default: 'ask',
      },
      {
        key: 'workspaces.whenBuildRunning',
        title: 'When a Build Is Already Running',
        description: 'What a new build does while another is running.',
        control: {
          kind: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'restart', label: 'Restart' },
            { value: 'queue', label: 'Queue' },
          ],
        },
        default: 'ask',
      },
      {
        key: 'workspaces.runTerminal',
        title: 'Run Terminal',
        description: 'Which terminal a run uses.',
        control: {
          kind: 'select',
          options: [
            { value: 'reuse-clear', label: 'Reuse and Clear' },
            { value: 'reuse-keep', label: 'Reuse and Keep' },
            { value: 'new', label: 'New Each Run' },
          ],
        },
        default: 'reuse-clear',
      },
      {
        key: 'workspaces.revealTerminalOnRun',
        title: 'Reveal Terminal on Run',
        description: 'When a run brings its terminal forward.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'failure', label: 'On Failure' },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'always',
      },
      {
        key: 'workspaces.newConfigurationsShowOutputIn',
        title: 'New Configurations Show Output In',
        description: 'Where a new run configuration shows its terminal. Each can change its own.',
        control: {
          kind: 'select',
          options: [
            { value: 'panel', label: 'Panel' },
            { value: 'window', label: 'Window' },
          ],
        },
        default: 'panel',
      },
      {
        key: 'workspaces.stopGracePeriod',
        title: 'Stop Grace Period',
        description: 'How long a stopped program has to finish before it is ended by force.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: '1 second' },
            { value: '5', label: '5 seconds' },
            { value: '10', label: '10 seconds' },
            { value: '30', label: '30 seconds' },
          ],
        },
        default: 5,
      },
      {
        key: 'workspaces.revealDebugOutputOnStart',
        title: 'Reveal Debug Output on Start',
        description: 'Bring the Logs panel forward when a debug session starts.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'workspaces.outputScrollbackLines',
        title: 'Output Scrollback Lines',
        description: 'How many lines the Logs panel keeps to scroll back through.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1000', label: '1,000' },
            { value: '5000', label: '5,000' },
            { value: '10000', label: '10,000' },
            { value: '50000', label: '50,000' },
          ],
        },
        default: 5000,
      },
      {
        key: 'workspaces.showDebugPanelsOnStart',
        title: 'Show Debug and Logs Panels on Debug Start',
        description: 'Add the Debug and Logs panels to the layout when a debug session starts.',
        control: { kind: 'toggle' },
        default: true,
      },
    ],
  },
  {
    // The Default Projects Folder row beside these is its own component: main's dialog chooses it.
    id: 'workspaces-new-projects',
    label: 'New Projects',
    settings: [
      {
        key: 'workspaces.askWhereToCreate',
        title: 'Ask Where to Create Each Time',
        description:
          'Choose the folder for every new project. When off, projects go straight into the Default Projects Folder.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'workspaces.sendFirstMessageAutomatically',
        title: 'Send First Message Automatically',
        description:
          'Send what you told the New Project wizard to the agent at once. When off, it waits in the message box for you to edit and send.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'workspaces.planBeforeBuilding',
        title: 'Plan Before Building',
        description:
          'Have the agent settle a plan with you before it creates files. When off, it starts building from what you told it.',
        control: { kind: 'toggle' },
        default: true,
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
        key: 'workspaces.addStudioUserFileToGitignore',
        title: 'Add Studio User File to .gitignore',
        description:
          "Add your personal workspace file, .studio/workspace.user.json, to the folder's .gitignore the first time Studio writes it, so it is never committed.",
        control: { kind: 'toggle' },
        default: true,
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
    // Code-wide behaviour that is neither how code looks nor how a language is edited: files on disk.
    id: 'code-general',
    label: 'Code',
    settings: [
      {
        key: 'textEditor.autoSave',
        title: 'Auto Save',
        description:
          'Save edited code and Markdown files on their own: a moment after you stop typing, or ' +
          'when you move away from the editor. A document never saved yet still asks where to go.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'delay', label: 'After a Delay' },
            { value: 'focus', label: 'When Focus Changes' },
          ],
        },
        default: 'off',
      },
      {
        key: 'textEditor.reloadOnDiskChange',
        title: 'Reload Files Changed on Disk',
        description:
          'What happens when a file you have not edited changes outside Studio: reload it ' +
          'silently, ask first, or leave the open copy as it is. A file you have edited always ' +
          'asks. Images and binary files follow this too.',
        control: {
          kind: 'select',
          options: [
            { value: 'silent', label: 'Reload Silently' },
            { value: 'ask', label: 'Ask' },
            { value: 'ignore', label: 'Ignore' },
          ],
        },
        default: 'ask',
      },
      {
        key: 'textEditor.largeFileSizeMb',
        title: 'Large File Size Limit',
        description:
          'The largest file that opens as text. A larger one opens in the binary editor instead.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '10', label: '10 MB' },
            { value: '50', label: '50 MB' },
            { value: '100', label: '100 MB' },
            { value: '250', label: '250 MB' },
          ],
        },
        default: 50,
      },
      {
        key: 'textEditor.largeFileLineThreshold',
        title: 'Large File Feature Threshold',
        description:
          'Above this many lines a file opens without the heavier editor features — folding, the ' +
          'minimap, highlighting of matching words and bracket colours — so it stays responsive.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '10000', label: '10,000 lines' },
            { value: '20000', label: '20,000 lines' },
            { value: '50000', label: '50,000 lines' },
            { value: '100000', label: '100,000 lines' },
          ],
        },
        default: 20000,
      },
      {
        key: 'textEditor.defaultLanguage',
        title: 'Default Language for New Documents',
        description: 'The language a new, untitled code document starts in.',
        control: { kind: 'select', options: [{ value: 'plaintext', label: 'Plain Text' }] },
        default: 'plaintext',
      },
      {
        key: 'textEditor.defaultEncoding',
        title: 'Default Encoding',
        description:
          'The encoding a new file is saved in, and the one a file is read in when its encoding ' +
          "can't be told from its bytes. The status strip reopens or saves any file in another.",
        control: {
          kind: 'select',
          options: TEXT_ENCODINGS.map(
            (encoding: TextEncoding): { value: string; label: string } => ({
              value: encoding,
              label: encodingLabel(encoding),
            }),
          ),
        },
        default: 'utf8',
      },
      {
        key: 'textEditor.autoDetectEncoding',
        title: 'Auto-Detect Encoding',
        description:
          "Tell a file's encoding from its bytes: UTF-8 when they are valid UTF-8, Default Encoding " +
          'otherwise. Off reads every file without a byte-order mark in Default Encoding.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.defaultEol',
        title: 'Default End of Line',
        description:
          'The line ending a new document starts with. A file that already exists keeps its own.',
        control: {
          kind: 'select',
          options: [
            { value: 'lf', label: 'LF' },
            { value: 'crlf', label: 'CRLF' },
            { value: 'system', label: 'System (CRLF on Windows, LF Elsewhere)' },
          ],
        },
        default: 'lf',
      },
      {
        key: 'textEditor.generatedCodeView',
        title: 'Generated Code Default View',
        description:
          "The view a generated-code panel opens on: the compiler's static output, or what the JIT " +
          'produces at run time. Starting on JIT runs the capture as the panel first shows.',
        control: {
          kind: 'select',
          options: [
            { value: 'static', label: 'Static' },
            { value: 'jit', label: 'JIT' },
          ],
        },
        default: 'static',
      },
    ],
  },
  {
    // Finding, going to and renaming, across the code.
    id: 'code-find',
    label: 'Code Find and Navigation',
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
        key: 'textEditor.goToSymbolMatching',
        title: 'Go to Symbol Matching',
        description:
          'How Go to Symbol matches what you type: names that contain it, or also names that hold ' +
          'its letters in order, so gcn finds getCustomerName.',
        control: {
          kind: 'select',
          options: [
            { value: 'contains', label: 'Contains' },
            { value: 'fuzzy', label: 'Fuzzy' },
          ],
        },
        default: 'contains',
      },
      {
        key: 'textEditor.seedFindFrom',
        title: 'Seed Find From',
        description:
          'What Find starts with when it opens: the selected text only, or the selection, else the ' +
          'word at the caret.',
        control: {
          kind: 'select',
          options: [
            { value: 'selection', label: 'Selection Only' },
            { value: 'selection-or-word', label: 'Selection or Word at Caret' },
          ],
        },
        default: 'selection-or-word',
      },
      {
        key: 'textEditor.confirmMultiFileRename',
        title: 'Confirm Multi-File Rename',
        description:
          'Ask before a rename changes more than one file, listing the files it changes.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.saveAfterRename',
        title: 'Save Files After Rename',
        description:
          'Save the open files a rename changed. Files that were not open are written as the ' +
          'rename is made either way.',
        control: { kind: 'toggle' },
        default: false,
      },
    ],
  },
  {
    // How diffs compare and show two versions of a file.
    id: 'code-diffs',
    label: 'Code Diffs',
    settings: [
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
      {
        key: 'textEditor.diffIgnoreWhitespace',
        title: 'Ignore Whitespace in Diffs',
        description:
          "Leave changes to leading and trailing whitespace out of a diff. The diff's own " +
          'whitespace switch changes it for the session.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'textEditor.diffCollapseUnchanged',
        title: 'Collapse Unchanged Regions',
        description:
          'Fold the long unchanged stretches between changes, leaving a few lines of context ' +
          'around each change. A folded stretch opens with a click.',
        control: { kind: 'toggle' },
        default: true,
      },
    ],
  },
  {
    // When language servers start, stop and come back.
    id: 'code-language-servers',
    label: 'Code Language Servers',
    settings: [
      {
        key: 'lsp.restartTries',
        title: 'Restart Crashed Language Servers',
        description:
          'How many times a language server that crashes is started again, waiting longer each ' +
          'time, before Studio gives up until you restart it. A server that crashes the same way ' +
          'twice is not restarted again.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Off' },
            { value: '3', label: '3 Tries' },
            { value: '5', label: '5 Tries' },
            { value: '10', label: '10 Tries' },
          ],
        },
        default: 5,
      },
      {
        key: 'lsp.idleStopMinutes',
        title: 'Stop Idle Language Servers After',
        description:
          'Stop the language servers of a workspace tab left in the background, and of a file ' +
          'opened outside a workspace once it closes, after this long. They start again when ' +
          'you come back.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '5', label: '5 Minutes' },
            { value: '10', label: '10 Minutes' },
            { value: '30', label: '30 Minutes' },
            { value: '0', label: 'Never' },
          ],
        },
        default: 10,
      },
      {
        key: 'lsp.startMode',
        title: 'Start Language Server',
        description:
          'Start the language server for a .NET, Node, JVM, Python, C++, Rust or Go workspace as ' +
          'the workspace opens, so it is ready by the first file, or only once the first file it ' +
          'serves is opened.',
        control: {
          kind: 'select',
          options: [
            { value: 'open', label: 'When the Workspace Opens' },
            { value: 'first-file', label: 'When the First File Opens' },
          ],
        },
        default: 'open',
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
        key: 'textEditor.global.fontLigatures',
        title: 'Font Ligatures',
        description: "Draw the font's ligatures, joining sequences such as => into one glyph.",
        control: { kind: 'toggle' },
        default: false,
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
        key: 'textEditor.global.cursorStyle',
        title: 'Cursor Style',
        description: 'The shape of the cursor.',
        control: {
          kind: 'select',
          options: [
            { value: 'line', label: 'Line' },
            { value: 'block', label: 'Block' },
            { value: 'underline', label: 'Underline' },
          ],
        },
        default: 'line',
      },
      {
        key: 'textEditor.global.cursorWidth',
        title: 'Cursor Width',
        description: 'The width of the line cursor.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: '1 px' },
            { value: '2', label: '2 px' },
            { value: '3', label: '3 px' },
          ],
        },
        visibleWhen: { key: 'textEditor.global.cursorStyle', equals: ['line'] },
        default: 2,
      },
      {
        key: 'textEditor.global.smoothScrolling',
        title: 'Smooth Scrolling',
        description: 'Animate scrolling. Reduce Motion also turns this off.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.scrollBeyondLastLine',
        title: 'Scroll Beyond Last Line',
        description: 'Let the editor scroll until the last line is at the top.',
        control: { kind: 'toggle' },
        default: false,
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
        key: 'textEditor.global.foldingControls',
        title: 'Folding Controls',
        description: 'When the fold controls show in the gutter.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'hover', label: 'On Hover' },
          ],
        },
        default: 'always',
      },
      {
        key: 'textEditor.global.foldingProvider',
        title: 'Folding Provider',
        description:
          'What folds the code. Automatic uses the language server where it folds, then brace folding where the language has it, then indentation. A choice that cannot fold a file falls back to indentation.',
        control: {
          kind: 'select',
          options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'language-server', label: 'Language Server' },
            { value: 'braces', label: 'Braces' },
            { value: 'indentation', label: 'Indentation' },
          ],
        },
        profileOverridable: true,
        default: 'automatic',
      },
      {
        key: 'textEditor.global.changeMargin',
        title: 'Change Margin',
        description: 'Which lines the bars beside the line numbers mark.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'unsaved', label: 'Unsaved Only' },
            { value: 'all', label: 'Saved and Unsaved' },
          ],
        },
        default: 'all',
      },
      {
        key: 'textEditor.global.mouseWheelZoom',
        title: 'Mouse Wheel Zoom',
        description: 'Zoom the editors with the mouse wheel while holding ⌘ or Ctrl.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        // Set from the zoom menu on the status strip, and remembered; it has no row of its own.
        key: 'textEditor.zoom',
        title: 'Editor Zoom',
        description: 'The zoom level of the code editors, as a percentage.',
        control: { kind: 'custom', component: 'editor-zoom' },
        default: 100,
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
          'Narrow, and Wide is double Regular. Paper, orientation and the rest are under Application › ' +
          'Printing.',
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
    // What the editor draws over the code: guides, rulers, hints and highlights. Split from Code Appearance
    // because a settings page is a flat list, and that one had outgrown it.
    id: 'code-highlighting',
    label: 'Code Guides and Highlights',
    settings: [
      {
        key: 'textEditor.global.colorBrackets',
        title: 'Coloured Brackets',
        description: 'Colour matching bracket pairs by their nesting depth.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.matchBrackets',
        title: 'Matching Bracket Highlight',
        description: 'Highlight the bracket that matches the one at the cursor.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.bracketPairGuides',
        title: 'Bracket Pair Guides',
        description: 'Draw a guide between matching brackets.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'active', label: 'Active Pair' },
            { value: 'all', label: 'All' },
          ],
        },
        default: 'off',
      },
      {
        key: 'textEditor.global.indentGuides',
        title: 'Indent Guides',
        description: 'Draw a guide at each indentation level.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
            { value: 'highlight-active', label: 'On and Highlight Active' },
          ],
        },
        default: 'highlight-active',
      },
      {
        key: 'textEditor.global.renderWhitespace',
        title: 'Render Whitespace',
        description: 'Which whitespace the editor draws.',
        control: {
          kind: 'select',
          options: [
            { value: 'none', label: 'None' },
            { value: 'boundary', label: 'Boundary' },
            { value: 'selection', label: 'Selection' },
            { value: 'trailing', label: 'Trailing' },
            { value: 'all', label: 'All' },
          ],
        },
        profileOverridable: true,
        default: 'selection',
      },
      {
        key: 'textEditor.global.rulers',
        title: 'Rulers',
        description: 'The columns to draw a ruler at, separated by commas.',
        control: { kind: 'text', placeholder: '80, 120' },
        profileOverridable: true,
        default: '',
      },
      {
        key: 'textEditor.global.inlayHints',
        title: 'Inlay Hints',
        description:
          'Show the hints a language server sets into the code, such as parameter names and inferred ' +
          'types. While Holding means ⌥ on macOS, and Ctrl+Alt elsewhere.',
        control: {
          kind: 'select',
          options: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
            { value: 'while-holding', label: 'While Holding' },
          ],
        },
        profileOverridable: true,
        default: 'on',
      },
      {
        key: 'textEditor.global.semanticHighlighting',
        title: 'Semantic Highlighting',
        description:
          'Colour types, members and parameters by what they are, not only how they read.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.highlightOccurrences',
        title: 'Highlight Occurrences',
        description: 'Highlight the other occurrences of the symbol at the cursor.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.selectionHighlight',
        title: 'Selection Highlight',
        description: 'Highlight the other matches of the selected text.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.colourSwatches',
        title: 'Colour Swatches',
        description: 'Show a swatch beside colour values.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.minimumDiagnosticSeverity',
        title: 'Minimum Diagnostic Severity',
        description:
          'The least severe problem the editor underlines. The Problems panel still lists them all.',
        control: {
          kind: 'select',
          options: [
            { value: 'hint', label: 'Hint' },
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'error', label: 'Error' },
          ],
        },
        profileOverridable: true,
        default: 'hint',
      },
    ],
  },
  {
    // How code is edited; the per-language overrides are edited on each language's page under Code › Languages.
    id: 'code-editing',
    label: 'Code Editing',
    settings: [
      {
        key: 'textEditor.honourEditorConfig',
        title: 'Honour EditorConfig',
        description:
          "Let a project's .editorconfig decide indentation, line endings, encoding, trailing " +
          'whitespace, the final newline and the ruler for the files it covers, over these settings ' +
          'and each language page.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.detectIndentation',
        title: 'Detect Indentation',
        description:
          "Read a file's indentation from its content. Tab Size and Insert Spaces apply to new and " +
          'empty files.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
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
        key: 'textEditor.global.defaultFormatter',
        title: 'Default Formatter',
        description:
          'Which formatter runs for TypeScript, JavaScript, JSON, CSS, SCSS, Less and HTML, the languages with a built-in one. With no language server formatting the language, the built-in one runs.',
        control: {
          kind: 'select',
          options: [
            { value: 'built-in', label: 'Built-in' },
            { value: 'language-server', label: 'Language Server' },
          ],
        },
        profileOverridable: true,
        default: 'language-server',
      },
      {
        key: 'textEditor.global.autoCloseBrackets',
        title: 'Auto Close Brackets and Quotes',
        description: 'When typing an opening bracket or quote also types its closing one.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'before-whitespace', label: 'Before Whitespace' },
            { value: 'never', label: 'Never' },
          ],
        },
        profileOverridable: true,
        default: 'before-whitespace',
      },
      {
        key: 'textEditor.global.autoSurround',
        title: 'Auto Surround',
        description: 'What typing a bracket or quote over a selection wraps it in.',
        control: {
          kind: 'select',
          options: [
            { value: 'brackets-and-quotes', label: 'Brackets and Quotes' },
            { value: 'brackets', label: 'Brackets' },
            { value: 'quotes', label: 'Quotes' },
            { value: 'never', label: 'Never' },
          ],
        },
        profileOverridable: true,
        default: 'brackets-and-quotes',
      },
      {
        key: 'textEditor.global.autoIndent',
        title: 'Auto Indent',
        description:
          "How a new line is indented: not at all, like the line above, by the language's brackets, " +
          'or by all of its indentation rules.',
        control: {
          kind: 'select',
          options: [
            { value: 'none', label: 'None' },
            { value: 'keep', label: 'Keep' },
            { value: 'brackets', label: 'Brackets' },
            { value: 'full', label: 'Full' },
          ],
        },
        profileOverridable: true,
        default: 'full',
      },
      {
        key: 'textEditor.global.linkedEditing',
        title: 'Linked Editing',
        description:
          "Edit a linked pair together, such as an HTML tag's opening and closing names, where the " +
          "language's server offers it.",
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.docCommentAutoInsert',
        title: 'Doc Comment Auto Insert',
        description:
          "Let the language's server fill in a doc comment as you begin one, where it offers that.",
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.multiCursorModifier',
        title: 'Multi-Cursor Modifier',
        description:
          'The key held to add a cursor by clicking. Go to Definition moves to the other one.',
        control: {
          kind: 'select',
          options: [
            { value: 'alt', label: '⌥-Click (Alt-Click)' },
            { value: 'ctrl-cmd', label: '⌘-Click (Ctrl-Click)' },
          ],
        },
        default: 'alt',
      },
      {
        key: 'textEditor.global.quickFixIndicator',
        title: 'Quick Fix Indicator',
        description: 'Show a lightbulb beside the line when fixes exist at the cursor.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'textEditor.global.quickFixIndicatorDelay',
        title: 'Quick Fix Indicator Delay',
        description: 'How long the cursor rests before the lightbulb looks for fixes.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Instant' },
            { value: '250', label: '250 ms' },
            { value: '500', label: '500 ms' },
          ],
        },
        visibleWhen: { key: 'textEditor.global.quickFixIndicator', equals: [true] },
        default: 250,
      },
      {
        key: 'textEditor.global.unusualLineTerminators',
        title: 'Unusual Line Terminators',
        description:
          'What to do with Line Separator and Paragraph Separator characters found in a document.',
        control: {
          kind: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'remove', label: 'Remove' },
            { value: 'ignore', label: 'Ignore' },
          ],
        },
        default: 'ask',
      },
      {
        key: 'textEditor.languageOverrides',
        title: 'Language Overrides',
        description:
          'Per-language overrides of the code settings, edited on each language page under Code › Languages.',
        control: { kind: 'custom', component: 'language-editor-overrides' },
        // C# ships with Allman braces, its own convention and Roslyn's default, over the global K&R —
        // an ordinary override, so the user can change or clear it like any other (#1177). Markdown
        // keeps trailing whitespace, where two spaces are a hard line break.
        default: {
          csharp: { braceStyle: 'allman' },
          markdown: { trimTrailingWhitespace: false },
        },
      },
    ],
  },
  {
    // What a save does to a file; the per-language overrides are edited on each language's page under
    // Code › Languages. An Auto Save after a delay leaves the text alone, as the user may be typing.
    id: 'code-saving',
    label: 'Code Saving',
    settings: [
      {
        key: 'textEditor.global.formatOnSave',
        title: 'Format on Save',
        description:
          "What a save lays out with the language's formatter. Changed Lines Only needs a formatter " +
          'that can format part of a file. An Auto Save after a delay never formats.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'whole', label: 'Whole File' },
            { value: 'changed', label: 'Changed Lines Only' },
          ],
        },
        profileOverridable: true,
        default: 'off',
      },
      {
        key: 'textEditor.global.organiseImportsOnSave',
        title: 'Organise Imports on Save',
        description: "Sort and tidy the imports on save, using the language's own tools.",
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        key: 'textEditor.global.trimTrailingWhitespace',
        title: 'Trim Trailing Whitespace on Save',
        description: 'Remove whitespace at the end of each line on save.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        key: 'textEditor.global.insertFinalNewline',
        title: 'Insert Final Newline',
        description: 'End the file with a newline on save.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        key: 'textEditor.global.trimFinalNewlines',
        title: 'Trim Final Newlines',
        description: 'Remove blank lines after the last line of text on save.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        key: 'textEditor.global.addByteOrderMark',
        title: 'Add Byte-Order Mark to New Files',
        description: 'Start a new UTF-8 file with a byte-order mark the first time it is saved.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
      {
        key: 'textEditor.global.formatOnPaste',
        title: 'Format on Paste',
        description: "Lay out pasted text using the language's formatter.",
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: false,
      },
    ],
  },
  {
    // How the editor offers help: its hover cards and its completion list.
    id: 'code-suggestions',
    label: 'Code Suggestions and Hover',
    settings: [
      {
        key: 'textEditor.global.showHoverCards',
        title: 'Show Hover Cards',
        description:
          'When resting the pointer shows a card. While Holding means ⌥ on macOS, and Ctrl+Alt elsewhere. ⌘K ⌘I always shows one at the cursor.',
        control: {
          kind: 'select',
          options: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
            { value: 'while-holding', label: 'While Holding' },
          ],
        },
        default: 'on',
      },
      {
        key: 'textEditor.global.hoverDelay',
        title: 'Hover Delay',
        description: 'How long the pointer rests before a card shows.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '250', label: '250 ms' },
            { value: '500', label: '500 ms' },
            { value: '1000', label: '1000 ms' },
          ],
        },
        default: 500,
      },
      {
        key: 'textEditor.global.quickSuggestions',
        title: 'Quick Suggestions',
        description:
          'Where the completion list opens by itself as you type. ⌃Space always opens it.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'code', label: 'Code Only' },
            { value: 'code-and-strings', label: 'Code and Strings' },
            { value: 'everywhere', label: 'Everywhere' },
          ],
        },
        profileOverridable: true,
        default: 'code',
      },
      {
        key: 'textEditor.global.quickSuggestionsDelay',
        title: 'Quick Suggestions Delay',
        description: 'How long after you stop typing the completion list opens by itself.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Instant' },
            { value: '100', label: '100 ms' },
            { value: '250', label: '250 ms' },
            { value: '500', label: '500 ms' },
          ],
        },
        default: 0,
      },
      {
        key: 'textEditor.global.suggestOnTriggerCharacters',
        title: 'Suggest on Trigger Characters',
        description:
          "Open the completion list on the language's own trigger characters, such as a dot.",
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.acceptSuggestionWith',
        title: 'Accept Suggestion With',
        description:
          'Which keys accept the focused completion. The other key does what it always does.',
        control: {
          kind: 'select',
          options: [
            { value: 'enter-and-tab', label: 'Enter and Tab' },
            { value: 'tab', label: 'Tab Only' },
            { value: 'enter', label: 'Enter Only' },
          ],
        },
        default: 'tab',
      },
      {
        key: 'textEditor.global.acceptOnCommitCharacter',
        title: 'Accept on Commit Character',
        description:
          'Accept the focused completion when you type a character it commits on, such as a dot after a member.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
      },
      {
        key: 'textEditor.global.wordBasedSuggestions',
        title: 'Word-Based Suggestions',
        description: 'Where the completion list finds words, for a file no language server serves.',
        control: {
          kind: 'select',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'this-file', label: 'This File' },
            { value: 'all-open-files', label: 'All Open Files' },
          ],
        },
        profileOverridable: true,
        default: 'this-file',
      },
      {
        key: 'textEditor.global.snippetSuggestions',
        title: 'Snippet Suggestions',
        description: 'Where snippets sit in the completion list.',
        control: {
          kind: 'select',
          options: [
            { value: 'top', label: 'Top' },
            { value: 'inline', label: 'Inline' },
            { value: 'bottom', label: 'Bottom' },
            { value: 'none', label: 'None' },
          ],
        },
        profileOverridable: true,
        default: 'inline',
      },
      {
        key: 'textEditor.global.suggestionSelection',
        title: 'Suggestion Selection',
        description: 'Which completion is focused when the list opens.',
        control: {
          kind: 'select',
          options: [
            { value: 'first', label: 'First' },
            { value: 'recently-used', label: 'Recently Used' },
          ],
        },
        default: 'recently-used',
      },
      {
        key: 'textEditor.global.completionInsertMode',
        title: 'Completion Insert Mode',
        description:
          'Whether accepting a completion keeps the text after the cursor, or replaces it.',
        control: {
          kind: 'select',
          options: [
            { value: 'insert', label: 'Insert' },
            { value: 'replace', label: 'Replace' },
          ],
        },
        default: 'insert',
      },
      {
        key: 'textEditor.global.suggestionListSize',
        title: 'Suggestion List Size',
        description: 'How many rows the completion list shows before it scrolls.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '8', label: '8' },
            { value: '12', label: '12' },
            { value: '16', label: '16' },
            { value: '20', label: '20' },
          ],
        },
        default: 12,
      },
      {
        key: 'textEditor.global.parameterHints',
        title: 'Parameter Hints',
        description: 'Show the signature card as you type a call. ⌘⇧Space always shows it.',
        control: { kind: 'toggle' },
        profileOverridable: true,
        default: true,
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
        title: 'Inline Code Font',
        description: 'Font family used for inline code. Code blocks follow the Code font.',
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
        key: 'markdownEditor.maxImageWidth',
        title: 'Maximum Image Width',
        description: 'The widest an image is drawn, as a share of the text column.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '50', label: '50%' },
            { value: '75', label: '75%' },
            { value: '100', label: '100%' },
          ],
        },
        default: 100,
      },
      {
        key: 'markdownEditor.paragraphLineHeight',
        title: 'Paragraph Line Height',
        description: 'The line height of body text, as a multiple of the font size.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1.4', label: '1.4' },
            { value: '1.6', label: '1.6' },
            { value: '1.8', label: '1.8' },
            { value: '2', label: '2.0' },
          ],
        },
        default: 1.6,
      },
      {
        key: 'markdownEditor.headingScale',
        title: 'Heading Size Scale',
        description: 'How much larger than body text headings are set.',
        control: {
          kind: 'select',
          options: [
            { value: 'compact', label: 'Compact' },
            { value: 'standard', label: 'Standard' },
            { value: 'large', label: 'Large' },
          ],
        },
        default: 'standard',
      },
      {
        key: 'markdownEditor.underlineLinks',
        title: 'Underline Links',
        description: 'Underline a link only while the pointer is over it, or always.',
        control: {
          kind: 'select',
          options: [
            { value: 'hover', label: 'On Hover' },
            { value: 'always', label: 'Always' },
          ],
        },
        default: 'hover',
      },
      {
        key: 'markdownEditor.cursorBlinking',
        title: 'Cursor Blinking',
        description:
          "How the caret blinks in a Markdown document. Code's cursor is set separately.",
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
        key: 'markdownEditor.codeBlockLineNumbers',
        title: 'Code Block Line Numbers',
        description: 'Number the lines of code blocks. Off keeps them compact.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'markdownEditor.mermaidTheme',
        title: 'Mermaid Theme',
        description:
          "The theme diagrams are drawn in. Automatic follows Studio's light or dark theme.",
        control: {
          kind: 'select',
          options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'neutral', label: 'Neutral' },
            { value: 'forest', label: 'Forest' },
            { value: 'base', label: 'Base' },
          ],
        },
        default: 'automatic',
      },
      {
        key: 'markdownEditor.mermaidBodyFont',
        title: 'Use Body Font in Diagrams',
        description: "Set a diagram's labels in the Body Font, rather than the system's font.",
        control: { kind: 'toggle' },
        default: true,
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
          'Narrow, and Wide is double Regular. Paper, orientation and the rest are under Application › ' +
          'Printing.',
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
    // How Markdown documents are edited: images, links, conversions, the editor's helpers and pasting.
    id: 'markdown-editing',
    label: 'Markdown Editing',
    settings: [
      {
        key: 'markdownEditor.pastedImageStorage',
        title: 'Pasted Image Storage',
        description:
          'Where an image pasted or dropped into a document goes. A document never saved yet embeds it.',
        control: {
          kind: 'select',
          options: [
            { value: 'embed', label: 'Embed in the Document' },
            { value: 'beside', label: 'Save Beside the Document' },
            { value: 'folder', label: 'Save in a Folder' },
          ],
        },
        default: 'folder',
      },
      {
        key: 'markdownEditor.pastedImageFolder',
        title: 'Pasted Image Folder',
        description: 'The folder beside the document that pasted images are saved in.',
        control: { kind: 'text', placeholder: 'assets' },
        visibleWhen: { key: 'markdownEditor.pastedImageStorage', equals: ['folder'] },
        default: 'assets',
      },
      {
        key: 'markdownEditor.insertedImagePaths',
        title: 'Inserted Image Paths',
        description:
          'How the path to a local image is written. Relative needs a document that has been saved.',
        control: {
          kind: 'select',
          options: [
            { value: 'relative', label: 'Relative' },
            { value: 'absolute', label: 'Absolute' },
          ],
        },
        default: 'relative',
      },
      {
        key: 'markdownEditor.openLinks',
        title: 'Open Links',
        description:
          'What opens a link in a document. Its tooltip offers to open it whichever you choose.',
        control: {
          kind: 'select',
          options: [
            { value: 'modifier', label: MODIFIER_CLICK },
            { value: 'click', label: 'Click' },
            { value: 'tooltip', label: 'Tooltip Only' },
          ],
        },
        default: 'modifier',
      },
      {
        key: 'markdownEditor.renderHtmlBlocks',
        title: 'Render HTML Blocks',
        description:
          'Render raw HTML through the sanitiser, which never lets a script through, or show it as text.',
        control: {
          kind: 'select',
          options: [
            { value: 'safe', label: 'Safe Subset' },
            { value: 'text', label: 'Show as Text' },
          ],
        },
        default: 'safe',
      },
      {
        key: 'markdownEditor.convertEmoji',
        title: 'Convert Emoji Shortcodes',
        description: 'Show a shortcode such as :smile: as its emoji.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.convertAlerts',
        title: 'Auto-Convert GitHub Alerts',
        description: 'Turn a quote into an alert as you type its [!NOTE] marker.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.subSuperscriptShortcuts',
        title: 'Sub/Superscript Shortcuts',
        description: 'Turn ~text~ into subscript and ^text^ into superscript as you type.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.colourSwatches',
        title: 'Colour Swatches in Inline Code',
        description: 'Show a swatch beside a colour written in inline code.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.floatingToolbar',
        title: 'Floating Formatting Toolbar',
        description: 'Show formatting buttons above selected text.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'markdownEditor.blockHandles',
        title: 'Block Handles',
        description: 'Show the handle beside a block that drags it and adds a block under it.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.slashMenu',
        title: 'Slash Menu',
        description: 'Open the block menu when you type a slash on an empty line.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.mathBlocks',
        title: 'Math Blocks Show',
        description:
          'What a math block shows while the caret is elsewhere: the equation, or its LaTeX.',
        control: {
          kind: 'select',
          options: [
            { value: 'preview', label: 'Preview' },
            { value: 'source', label: 'Source' },
          ],
        },
        default: 'preview',
      },
      {
        key: 'markdownEditor.smartPunctuation',
        title: 'Smart Punctuation',
        description:
          'Turn straight quotes into curly ones, three dots into an ellipsis and two hyphens into a dash as you type.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'markdownEditor.undoHistory',
        title: 'Undo History',
        description: 'How many steps Undo can go back in a document.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '100', label: '100 Steps' },
            { value: '250', label: '250 Steps' },
            { value: '500', label: '500 Steps' },
            { value: '1000', label: '1000 Steps' },
          ],
        },
        default: 100,
      },
      {
        key: 'markdownEditor.defaultPaste',
        title: 'Default Paste',
        description:
          'How text on the clipboard pastes: read as Markdown, as plain text, or as a code block. The ribbon offers the others.',
        control: {
          kind: 'select',
          options: [
            { value: 'markdown', label: 'Markdown' },
            { value: 'plain', label: 'Plain Text' },
            { value: 'code', label: 'Code Block' },
          ],
        },
        default: 'markdown',
      },
      {
        key: 'markdownEditor.richPaste',
        title: 'Rich Paste Formatting',
        description:
          'How much formatting survives a paste from a web page or a word processor. Basic Only keeps emphasis, links, lists and headings.',
        control: {
          kind: 'select',
          options: [
            { value: 'keep', label: 'Keep' },
            { value: 'basic', label: 'Basic Only' },
            { value: 'none', label: 'None' },
          ],
        },
        default: 'keep',
      },
      {
        key: 'markdownEditor.openFilesIn',
        title: 'Open Markdown Files In',
        description:
          'Which editor a Markdown file opens in: the visual editor, or the code editor on its source.',
        control: {
          kind: 'select',
          options: [
            { value: 'visual', label: 'Visual' },
            { value: 'source', label: 'Source' },
          ],
        },
        default: 'visual',
      },
      {
        key: 'markdownEditor.outlineDepth',
        title: 'Outline Depth',
        description:
          'The deepest heading level the Outline panel lists. It shows that level and above.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: 'Heading Level 1' },
            { value: '2', label: 'Heading Level 2' },
            { value: '3', label: 'Heading Level 3' },
            { value: '4', label: 'Heading Level 4' },
            { value: '5', label: 'Heading Level 5' },
            { value: '6', label: 'Heading Level 6' },
          ],
        },
        default: 6,
      },
    ],
  },
  {
    // Checking and reading a Markdown document: spelling, review rules, Read Aloud and reading time.
    id: 'markdown-review',
    label: 'Markdown Review and Reading',
    settings: [
      {
        key: 'markdownEditor.checkSpelling',
        title: 'Check Spelling as You Type',
        description:
          'Underline misspelled words in the document, whether or not the Review panel is open. Spell Checking under Application › General has to be on too.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'spelling.personalDictionary',
        title: 'Personal Dictionary',
        description:
          'Words never marked as misspelled, in Markdown review or in any text box. Shared with ' +
          "the system's own dictionary on macOS and Windows.",
        control: { kind: 'custom', component: 'personal-dictionary' },
        default: [],
      },
      {
        key: 'markdownEditor.reviewRepeatedWord',
        title: 'Review Repeated Words',
        description: 'Flag a word written twice in a row.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.reviewPassiveVoice',
        title: 'Review Passive Voice',
        description: 'Flag sentences written in the passive voice.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.reviewArticleAgreement',
        title: 'Review Article Agreement',
        description: 'Flag "a" written before a vowel.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.reviewWeakIntensifier',
        title: 'Review Weak Intensifiers',
        description: 'Flag "very" and "really".',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.reviewSerialComma',
        title: 'Serial Comma',
        description: 'Ask for a comma before the last item of a list, flag one, or say nothing.',
        control: {
          kind: 'select',
          options: [
            { value: 'require', label: 'Require' },
            { value: 'forbid', label: 'Forbid' },
            { value: 'off', label: 'Off' },
          ],
        },
        default: 'require',
      },
      {
        key: 'markdownEditor.readAloudVoice',
        title: 'Read Aloud Voice',
        description:
          'The voice documents are read in. The Reader panel can change it for a session.',
        control: { kind: 'custom', component: 'read-aloud-voice' },
        default: '',
      },
      {
        key: 'markdownEditor.enhancedVoicesOnly',
        title: 'Show Only Enhanced Voices',
        description:
          'List only the higher-quality voices. All voices are listed when none are installed.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.readAloudSpeed',
        title: 'Read Aloud Speed',
        description: 'How fast documents are read.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0.5', label: '0.5×' },
            { value: '0.75', label: '0.75×' },
            { value: '1', label: '1×' },
            { value: '1.25', label: '1.25×' },
            { value: '1.5', label: '1.5×' },
            { value: '2', label: '2×' },
          ],
        },
        default: 1,
      },
      {
        key: 'markdownEditor.readAloudPitch',
        title: 'Read Aloud Pitch',
        description: 'The pitch of the reading voice.',
        control: {
          kind: 'select',
          options: [
            { value: 'low', label: 'Low' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ],
        },
        default: 'normal',
      },
      {
        key: 'markdownEditor.readAloudVolume',
        title: 'Read Aloud Volume',
        description: 'How loud documents are read.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '25', label: '25%' },
            { value: '50', label: '50%' },
            { value: '75', label: '75%' },
            { value: '100', label: '100%' },
          ],
        },
        default: 100,
      },
      {
        key: 'markdownEditor.readAlongHighlight',
        title: 'Read-Along Highlight',
        description: 'What is highlighted as a document is read.',
        control: {
          kind: 'select',
          options: [
            { value: 'word', label: 'Word' },
            { value: 'sentence', label: 'Sentence' },
            { value: 'none', label: 'None' },
          ],
        },
        default: 'word',
      },
      {
        key: 'markdownEditor.followSpokenWord',
        title: 'Follow Spoken Word',
        description: 'Scroll the document to keep the word being read in view.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'markdownEditor.readingSpeed',
        title: 'Reading Speed',
        description: "The words per minute behind the status strip's reading time.",
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '150', label: '150 Words per Minute' },
            { value: '200', label: '200 Words per Minute' },
            { value: '250', label: '250 Words per Minute' },
            { value: '300', label: '300 Words per Minute' },
          ],
        },
        default: 200,
      },
    ],
  },
  {
    id: 'images',
    label: 'Images',
    settings: [
      {
        key: 'imageViewer.zoomOnOpen',
        title: 'Zoom on Open',
        description: 'How large an image first shows.',
        control: {
          kind: 'select',
          options: [
            { value: 'fit', label: 'Fit' },
            { value: 'actual', label: 'Actual Size' },
          ],
        },
        default: 'fit',
      },
      {
        key: 'imageViewer.enlargeSmallImages',
        title: 'Enlarge Small Images to Fit',
        description: 'Scale an image smaller than the window up to fill it when fitting.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'imageViewer.defaultBackground',
        title: 'Default Background',
        description: 'What an image is shown against. The ribbon changes it for that image only.',
        control: {
          kind: 'select',
          options: [
            { value: 'checker', label: 'Checkerboard' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'theme', label: 'Theme' },
          ],
        },
        default: 'checker',
      },
      {
        key: 'imageViewer.checkerboardSize',
        title: 'Checkerboard Size',
        description: 'The size of the checkerboard squares.',
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
        key: 'imageViewer.smoothing',
        title: 'Image Smoothing',
        description: 'How a scaled image is drawn. Automatic shows the pixels from 400% up.',
        control: {
          kind: 'select',
          options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'smooth', label: 'Always Smooth' },
            { value: 'sharp', label: 'Always Sharp' },
          ],
        },
        default: 'automatic',
      },
      {
        key: 'imageViewer.mouseWheel',
        title: 'Mouse Wheel',
        description: 'What the wheel does over an image. Holding ⌘ (Ctrl elsewhere) always zooms.',
        control: {
          kind: 'select',
          options: [
            { value: 'scroll', label: 'Scroll' },
            { value: 'zoom', label: 'Zoom' },
          ],
        },
        default: 'scroll',
      },
      {
        key: 'imageViewer.undoHistory',
        title: 'Undo History',
        description: 'How many edits Undo can go back. Each one holds a whole image in memory.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '10', label: '10 Edits' },
            { value: '20', label: '20 Edits' },
            { value: '50', label: '50 Edits' },
          ],
        },
        default: 20,
      },
      {
        key: 'imageViewer.saveQuality',
        title: 'Save Quality',
        description: 'The quality an edited JPEG or WebP is saved back at.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '75', label: '75%' },
            { value: '85', label: '85%' },
            { value: '92', label: '92%' },
            { value: '100', label: '100%' },
          ],
        },
        default: 92,
      },
      {
        key: 'imageViewer.fallbackSaveFormat',
        title: 'Fallback Save Format',
        description:
          "What saving an edited GIF, BMP, ICO or AVIF does, since those can't be written back: offer to save it as a PNG or a WebP, or open the export tool to ask.",
        control: {
          kind: 'select',
          options: [
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WebP' },
            { value: 'ask', label: 'Ask' },
          ],
        },
        default: 'png',
      },
      {
        key: 'imageViewer.openIn',
        title: 'Open Images In',
        description:
          'Where an image from a workspace opens: beside its documents, or in a tab of its own.',
        control: {
          kind: 'select',
          options: [
            { value: 'workspace', label: 'Workspace' },
            { value: 'tab', label: 'New Tab' },
          ],
        },
        default: 'workspace',
      },
      {
        key: 'imageViewer.openSvgAs',
        title: 'Open SVG Files As',
        description:
          "Whether an SVG opens as a picture or as its source. Either way, the Explorer's menu offers Open as Code.",
        control: {
          kind: 'select',
          options: [
            { value: 'image', label: 'Image' },
            { value: 'code', label: 'Code' },
          ],
        },
        default: 'image',
      },
    ],
  },
  {
    id: 'binary',
    label: 'Binary',
    settings: [
      {
        key: 'binaryEditor.bytesPerRow',
        title: 'Bytes per Row',
        description: 'How many bytes a row starts with. The ribbon changes it per file.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '8', label: '8' },
            { value: '16', label: '16' },
            { value: '32', label: '32' },
            { value: '64', label: '64' },
          ],
        },
        default: 16,
      },
      {
        key: 'binaryEditor.byteGrouping',
        title: 'Byte Grouping',
        description: 'Set a gap after every few bytes in a row.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'None' },
            { value: '2', label: '2 Bytes' },
            { value: '4', label: '4 Bytes' },
            { value: '8', label: '8 Bytes' },
          ],
        },
        default: 0,
      },
      {
        key: 'binaryEditor.hexCase',
        title: 'Hex Letter Case',
        description: 'Whether hex is shown in upper or lower case. Copy follows it.',
        control: {
          kind: 'select',
          options: [
            { value: 'upper', label: 'Upper' },
            { value: 'lower', label: 'Lower' },
          ],
        },
        default: 'upper',
      },
      {
        key: 'binaryEditor.showTextColumn',
        title: 'Show Text Column',
        description: 'Show the bytes as text beside their hex.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'binaryEditor.textEncoding',
        title: 'Text Column Encoding',
        description: 'How the text column reads the bytes.',
        control: {
          kind: 'select',
          options: [
            { value: 'ascii', label: 'ASCII' },
            { value: 'latin1', label: 'Latin-1' },
            { value: 'utf8', label: 'UTF-8' },
          ],
        },
        visibleWhen: { key: 'binaryEditor.showTextColumn', equals: [true] },
        default: 'ascii',
      },
      {
        key: 'binaryEditor.addressFormat',
        title: 'Address Format',
        description: "How a row's offset is written: hex split into two halves, hex, or decimal.",
        control: {
          kind: 'select',
          options: [
            { value: 'hex-split', label: 'Hex Split' },
            { value: 'hex', label: 'Hex' },
            { value: 'decimal', label: 'Decimal' },
          ],
        },
        default: 'hex-split',
      },
      {
        key: 'binaryEditor.typingMode',
        title: 'Typing Mode',
        description: 'Whether typing replaces bytes or adds them. The ribbon changes it per file.',
        control: {
          kind: 'select',
          options: [
            { value: 'overwrite', label: 'Overwrite' },
            { value: 'insert', label: 'Insert' },
          ],
        },
        default: 'overwrite',
      },
      {
        key: 'binaryEditor.openReadOnly',
        title: 'Open Read-Only',
        description: "Open files locked against typing. The ribbon's Edit button unlocks one.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'binaryEditor.jumpOnOpen',
        title: 'Jump on Open',
        description: 'Where an executable opens: at its entry point, or at the start of the file.',
        control: {
          kind: 'select',
          options: [
            { value: 'entry', label: 'Entry Point' },
            { value: 'start', label: 'Start of File' },
          ],
        },
        default: 'entry',
      },
      {
        key: 'binaryEditor.copyFormat',
        title: 'Copy Format',
        description: "How the ribbon's Copy writes the selected bytes.",
        control: {
          kind: 'select',
          options: [
            { value: 'hex', label: 'Hex' },
            { value: '0x', label: '0x List' },
            { value: 'c-array', label: 'C Array' },
            { value: 'base64', label: 'Base64' },
            { value: 'text', label: 'Text' },
          ],
        },
        default: 'hex',
      },
      {
        key: 'binaryEditor.inspectorEndian',
        title: 'Inspector Byte Order',
        description:
          'The byte order the Inspector starts with. Its own switch changes it for the session.',
        control: {
          kind: 'select',
          options: [
            { value: 'little', label: 'Little Endian' },
            { value: 'big', label: 'Big Endian' },
          ],
        },
        default: 'little',
      },
      {
        key: 'binaryEditor.inspectorSign',
        title: 'Inspector Integers',
        description: 'Whether the Inspector starts with signed or unsigned integers.',
        control: {
          kind: 'select',
          options: [
            { value: 'signed', label: 'Signed' },
            { value: 'unsigned', label: 'Unsigned' },
          ],
        },
        default: 'signed',
      },
      {
        key: 'binaryEditor.doubleClickSelects',
        title: 'Double-Click Selects',
        description:
          'What a double-click on a byte selects: the instruction around it, or the byte itself.',
        control: {
          kind: 'select',
          options: [
            { value: 'instruction', label: 'Instruction' },
            { value: 'byte', label: 'Byte' },
          ],
        },
        default: 'instruction',
      },
      {
        key: 'binaryEditor.loadSymbolFiles',
        title: 'Load Symbol Files (PDB)',
        description: 'Give a decoder the .pdb beside a file, so its listing can name things.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'binaryEditor.decodeLimit',
        title: 'Decode Limit',
        description:
          'The largest file a whole-file decoder reads. A file over it says so in the Assembly panel.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '64', label: '64 MB' },
            { value: '256', label: '256 MB' },
            { value: '0', label: 'No Limit' },
          ],
        },
        default: 64,
      },
    ],
  },
  {
    id: 'vc-fetch',
    label: 'Fetch, Pull and Push',
    settings: [
      {
        key: 'versionControl.autoFetchMinutes',
        title: 'Auto-Fetch Interval',
        description:
          'How often an open repository fetches its remotes in the background, so ahead and behind ' +
          'counts stay current.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Off' },
            { value: '5', label: 'Every 5 minutes' },
            { value: '15', label: 'Every 15 minutes' },
            { value: '30', label: 'Every 30 minutes' },
          ],
        },
        default: 15,
      },
      {
        key: 'versionControl.fetchOnLoad',
        title: 'Fetch on Load',
        description: 'Fetch as soon as a repository opens, whatever the interval.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'versionControl.defaultRemote',
        title: 'Default Remote',
        description:
          'The remote a branch with no upstream is pushed to, and the one whose code host is used ' +
          'when a repository has several. Falls back to the first remote when it has none by this name.',
        control: { kind: 'text', placeholder: 'origin' },
        default: 'origin',
      },
      {
        key: 'versionControl.pruneOnFetch',
        title: 'Prune on Fetch',
        description:
          'Remove remote-tracking branches that were deleted on the remote whenever you fetch. Off ' +
          'by default because it deletes; Prune on a remote still does it on request.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'versionControl.pullMode',
        title: 'Pull Mode',
        description: "How a pull brings in the upstream's commits.",
        control: {
          kind: 'select',
          options: [
            { value: 'config', label: "Follow git's configuration" },
            { value: 'merge', label: 'Merge' },
            { value: 'rebase', label: 'Rebase' },
            { value: 'ff-only', label: 'Fast-forward only' },
          ],
        },
        default: 'config',
      },
      {
        key: 'versionControl.setUpstreamOnPush',
        title: 'Set Upstream Automatically on Push',
        description:
          'When a branch with no upstream is first pushed, set the remote branch as its upstream, or ' +
          'ask first.',
        control: {
          kind: 'select',
          options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'ask', label: 'Ask' },
          ],
        },
        default: 'automatic',
      },
      {
        key: 'versionControl.networkTimeoutMinutes',
        title: 'Git Network Timeout',
        description:
          'How long a fetch, pull or push may take before it is stopped. Cloning keeps its own, longer limit.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1', label: '1 minute' },
            { value: '2', label: '2 minutes' },
            { value: '5', label: '5 minutes' },
            { value: '10', label: '10 minutes' },
            { value: '0', label: 'No limit' },
          ],
        },
        default: 2,
      },
    ],
  },
  {
    id: 'vc-commits',
    label: 'Commits and Branches',
    settings: [
      {
        key: 'versionControl.includeUntrackedInCommit',
        title: 'Include Untracked Files in Commit by Default',
        description:
          'Tick new files git is not yet tracking when the commit panel opens. You can always tick ' +
          'or untick each file.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'versionControl.checkOutNewBranch',
        title: 'Check Out New Branch by Default',
        description: 'Start the New Branch dialog with Check Out ticked.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'versionControl.signCommits',
        title: 'Sign Commits',
        description:
          "Sign each commit with your GPG or SSH signing key, or leave it to git's configuration.",
        control: {
          kind: 'select',
          options: [
            { value: 'config', label: "Follow git's configuration" },
            { value: 'always', label: 'Always' },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'config',
      },
      {
        key: 'versionControl.signOff',
        title: 'Add Signed-off-by',
        description: 'Add a Signed-off-by line with your name and email to each commit message.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'versionControl.runCommitHooks',
        title: 'Run Commit Hooks',
        description: "Run the repository's pre-commit and commit-msg hooks when committing.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'versionControl.stashIncludesUntracked',
        title: 'Stash Includes Untracked Files',
        description: 'Stash new files git is not tracking along with your other changes.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'versionControl.defaultBranchName',
        title: 'Default Branch Name for New Repositories',
        description:
          "The first branch of a repository Studio creates. Leave empty to use git's own default.",
        control: { kind: 'text', placeholder: 'main' },
        default: 'main',
      },
    ],
  },
  {
    id: 'vc-history',
    label: 'History',
    settings: [
      {
        key: 'versionControl.historyDateFormat',
        title: 'History Date Format',
        description: 'How commit dates read in the history.',
        control: {
          kind: 'select',
          options: [
            { value: 'relative', label: 'Relative (3 days ago)' },
            { value: 'absolute', label: 'Absolute (date and time)' },
            { value: 'both', label: 'Both' },
          ],
        },
        default: 'relative',
      },
      {
        key: 'versionControl.historyPageSize',
        title: 'History Page Size',
        description:
          'How many commits the history loads at a time; Load More brings the next page.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '100', label: '100 commits' },
            { value: '250', label: '250 commits' },
            { value: '500', label: '500 commits' },
            { value: '1000', label: '1,000 commits' },
          ],
        },
        default: 500,
      },
    ],
  },
  {
    id: 'vc-hosting',
    label: 'Hosting',
    settings: [
      {
        key: 'versionControl.hostingRefreshSeconds',
        title: 'Hosting Refresh Interval',
        description:
          'How often the pull requests, issues and CI runs you have open are re-read from the code ' +
          'host. Unchanged lists cost nothing against its rate limit.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Off' },
            { value: '30', label: 'Every 30 seconds' },
            { value: '60', label: 'Every minute' },
            { value: '300', label: 'Every 5 minutes' },
          ],
        },
        default: 60,
      },
      {
        key: 'versionControl.hostingListSize',
        title: 'Hosting List Size',
        description:
          'How many pull requests, issues or CI runs a list shows; Load More brings more.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '25', label: '25' },
            { value: '50', label: '50' },
            { value: '100', label: '100' },
          ],
        },
        default: 50,
      },
      {
        key: 'versionControl.ciRunsScope',
        title: 'CI Runs Scope',
        description: "Show CI runs for every branch, or only the checked-out branch's.",
        control: {
          kind: 'select',
          options: [
            { value: 'all', label: 'All branches' },
            { value: 'branch', label: 'Current branch' },
          ],
        },
        default: 'all',
      },
      {
        key: 'versionControl.pullRequestAndIssueStates',
        title: 'PR and Issue States',
        description:
          'Show only open pull requests and issues, or every state. The panel can switch for the ' +
          'session without changing this.',
        control: {
          kind: 'select',
          options: [
            { value: 'open', label: 'Open' },
            { value: 'all', label: 'All' },
          ],
        },
        default: 'open',
      },
    ],
  },
  {
    id: 'vc-cloning',
    label: 'Cloning',
    settings: [
      {
        key: 'versionControl.askWhereToClone',
        title: 'Ask Where to Clone Each Time',
        description:
          'Choose the folder for every clone. When off, clones go straight into the Default Clone ' +
          'Folder.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'versionControl.cloneLayout',
        title: 'Default Clone Layout',
        description: 'How a clone is laid out on disk, or Ask to choose for each clone.',
        control: {
          kind: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'flat', label: 'Flat Repository' },
            { value: 'worktree', label: 'Worktree Repository' },
          ],
        },
        default: 'ask',
      },
      {
        key: 'versionControl.cloneProtocol',
        title: 'Clone Protocol',
        description:
          'Which address a repository from a signed-in host clones from. SSH needs a key the host ' +
          'knows; a typed URL is cloned as typed.',
        control: {
          kind: 'select',
          options: [
            { value: 'https', label: 'HTTPS' },
            { value: 'ssh', label: 'SSH' },
          ],
        },
        default: 'https',
      },
      {
        key: 'versionControl.cloneSubmodules',
        title: 'Include Submodules',
        description: "Clone a repository's submodules along with it.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'versionControl.shallowClone',
        title: 'Shallow Clone',
        description:
          'Fetch the full history, or only the latest commit of each branch: faster for large ' +
          'repositories, with older history left out.',
        control: {
          kind: 'select',
          options: [
            { value: 'full', label: 'Full History' },
            { value: 'latest', label: 'Latest Commit Only' },
          ],
        },
        default: 'full',
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
      {
        // Keyed under ai., where it began, so a choice made before it moved to Terminal is kept.
        key: 'ai.agentShell',
        title: 'Agent Shell',
        description:
          'The shell whose profile the agent sources its environment (PATH, tokens) from. Choose an ' +
          'installed shell, or use the default login shell.',
        control: { kind: 'custom', component: 'ai-agent-shell' },
        default: '',
      },
      {
        key: 'terminal.shellArguments',
        title: 'Shell Arguments',
        description:
          'Arguments a new terminal starts its shell with, written as on a command line, such as ' +
          '--norc. Quote an argument that holds spaces.',
        control: { kind: 'text', placeholder: 'None' },
        default: '',
      },
      {
        key: 'terminal.loginShell',
        title: 'Start as Login Shell',
        description:
          'Start the shell as a login shell, so it reads your login profile (.zprofile, ' +
          '.bash_profile) as well.',
        platforms: ['darwin', 'linux'],
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'terminal.confirmClose',
        title: 'Confirm Before Closing a Running Terminal',
        description:
          'Ask before closing a terminal: every time, only while a program other than the shell is ' +
          'running in it, or never.',
        control: {
          kind: 'select',
          options: [
            { value: 'always', label: 'Always' },
            { value: 'running', label: 'When Running' },
            { value: 'never', label: 'Never' },
          ],
        },
        default: 'running',
      },
      {
        key: 'terminal.onShellExit',
        title: 'When the Shell Exits',
        description:
          'Keep a terminal open with its output when its shell exits, close it, or close it only ' +
          'when the shell exited without an error. A run or task always stays, to show how it ended.',
        control: {
          kind: 'select',
          options: [
            { value: 'keep', label: 'Keep Open' },
            { value: 'close', label: 'Close' },
            { value: 'close-if-clean', label: 'Close If Clean' },
          ],
        },
        default: 'keep',
      },
    ],
  },
  {
    id: 'terminal-appearance',
    label: 'Terminal Appearance',
    settings: [
      {
        key: 'terminal.fontFamily',
        title: 'Font Family',
        description:
          "The terminal's font: the one Code › Appearance uses, or a monospace font of its own. " +
          'Only installed fonts are offered.',
        control: {
          kind: 'select',
          options: [{ value: TERMINAL_FONT_SAME_AS_CODE, label: 'Same as Code' }],
        },
        default: TERMINAL_FONT_SAME_AS_CODE,
      },
      {
        key: 'terminal.fontSize',
        title: 'Font Size',
        description:
          "The terminal's font size: Code's, or a size of its own. Either way it follows the " +
          'editor zoom.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Same as Code' },
            { value: '10', label: '10' },
            { value: '11', label: '11' },
            { value: '12', label: '12' },
            { value: '13', label: '13' },
            { value: '14', label: '14' },
            { value: '16', label: '16' },
            { value: '18', label: '18' },
            { value: '20', label: '20' },
            { value: '24', label: '24' },
          ],
        },
        default: 0,
      },
      {
        key: 'terminal.scrollback',
        title: 'Scrollback Lines',
        description:
          'How many lines of output a terminal keeps above the screen. More lines use more memory.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '1000', label: '1,000' },
            { value: '5000', label: '5,000' },
            { value: '10000', label: '10,000' },
            { value: '50000', label: '50,000' },
          ],
        },
        default: 5000,
      },
      {
        key: 'terminal.cursorStyle',
        title: 'Cursor Style',
        description: "The shape of the terminal's cursor.",
        control: {
          kind: 'select',
          options: [
            { value: 'block', label: 'Block' },
            { value: 'bar', label: 'Bar' },
            { value: 'underline', label: 'Underline' },
          ],
        },
        default: 'block',
      },
      {
        key: 'terminal.cursorBlink',
        title: 'Cursor Blink',
        description: "Blink the terminal's cursor. A read-only task's console never blinks.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'terminal.renderer',
        title: 'Renderer',
        description:
          'Draw terminals on the GPU, which keeps heavy output smooth, or with the standard ' +
          'renderer, which can fix drawing glitches. The GPU is used only while Graphics ' +
          'Acceleration is on.',
        control: {
          kind: 'select',
          options: [
            { value: 'gpu', label: 'GPU' },
            { value: 'standard', label: 'Standard' },
          ],
        },
        default: 'gpu',
      },
    ],
  },
  {
    id: 'terminal-input',
    label: 'Terminal Input',
    settings: [
      {
        key: 'terminal.optionAsMeta',
        title: 'Use Option as Meta',
        description:
          'Send Option-key chords to the shell as Meta (Alt), for word movement and shortcuts in ' +
          'programs like Emacs. Off types the characters Option makes, such as # and €.',
        platforms: ['darwin'],
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'terminal.copyOnSelect',
        title: 'Copy on Select',
        description: 'Copy text to the clipboard as soon as it is selected in a terminal.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'terminal.rightClick',
        title: 'Right-Click',
        description:
          "What a right-click in a terminal does. A right-click on a link always opens the link's " +
          'menu.',
        control: {
          kind: 'select',
          options: [
            { value: 'menu', label: 'Menu (Copy, Paste, Clear, Find)' },
            { value: 'paste', label: 'Paste' },
            { value: 'select-word', label: 'Select Word' },
          ],
        },
        default: 'menu',
      },
      {
        key: 'terminal.warnMultiLinePaste',
        title: 'Warn Before Multi-Line Paste',
        description:
          'Ask before pasting text of more than one line, which a shell may run line by line as ' +
          'soon as it arrives.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'terminal.linkOpening',
        title: 'Link Opening',
        description:
          'How addresses and file paths in terminal output open. Off leaves them as plain text.',
        control: {
          kind: 'select',
          options: [
            { value: 'modifier', label: MODIFIER_CLICK },
            { value: 'click', label: 'Click' },
            { value: 'off', label: 'Off' },
          ],
        },
        default: 'modifier',
      },
      {
        key: 'terminal.bell',
        title: 'Bell',
        description: 'What a terminal does when a program rings its bell.',
        control: {
          kind: 'select',
          options: [
            { value: 'none', label: 'None' },
            { value: 'sound', label: 'Sound' },
            { value: 'visual', label: 'Visual (Flash the Terminal)' },
          ],
        },
        default: 'none',
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
        key: 'ai.requireOsSandbox',
        title: 'Require OS Sandbox',
        description:
          "Refuse the agent's shell commands on a machine with no OS sandbox, and say why, rather than run them unprotected. macOS always has one; Linux needs bubblewrap and socat; Windows has none. Applies to Claude; Codex always runs in its own sandbox.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'ai.autoAllowSandboxedShell',
        title: 'Auto-Allow Sandboxed Shell Commands',
        description:
          'Let a shell command that runs inside the OS sandbox go ahead without asking. A command that asks to leave the sandbox still asks, and a tool set to Deny stays denied. Applies to Claude.',
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
        key: 'ai.defaultReasoningEffort',
        title: 'Default Reasoning Effort',
        description:
          'How hard a new conversation thinks before it answers. Where a provider lacks the level, ' +
          'the nearest one it offers is used. /effort changes it for one conversation.',
        control: {
          kind: 'select',
          options: [
            { value: 'provider', label: 'Provider default' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ],
        },
        default: 'provider',
      },
      {
        key: 'ai.maxStepsPerTurn',
        title: 'Maximum Agent Steps per Turn',
        description:
          'How many steps, each a model reply or a tool call, one turn may take before the agent ' +
          'stops. Applies to OpenAI, Gemini, DeepSeek, Grok, Ollama and other compatible ' +
          'providers; Claude and Codex run their own loop.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '16', label: '16' },
            { value: '32', label: '32' },
            { value: '64', label: '64' },
            { value: '0', label: 'No limit' },
          ],
        },
        default: 16,
      },
      {
        key: 'ai.autoCompactThreshold',
        title: 'Auto-Compact Threshold',
        description:
          "How full a conversation's context window gets before it is compacted into a summary. " +
          'Only where the window is known.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Off' },
            { value: '75', label: '75% of the context window' },
            { value: '90', label: '90% of the context window' },
          ],
        },
        default: 0,
      },
      {
        key: 'ai.autoCompactMode',
        title: 'At Threshold',
        description:
          'Ask first, with a Compact button above the message box, or compact on its own.',
        control: {
          kind: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'automatic', label: 'Automatic' },
          ],
        },
        visibleWhen: { key: 'ai.autoCompactThreshold', equals: [75, 90] },
        default: 'ask',
      },
      {
        key: 'ai.deleteConversationsAfterDays',
        title: 'Delete Conversations After',
        description:
          'Delete saved conversations that have had no new messages for this long. Checked when Studio starts.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '0', label: 'Never' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '365 days' },
          ],
        },
        default: 0,
      },
      {
        key: 'ai.deleteConversationsMode',
        title: 'When Conversations Are Due',
        description: 'Ask first, offering to review which go, or delete them on their own.',
        control: {
          kind: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'automatic', label: 'Automatic' },
          ],
        },
        visibleWhen: { key: 'ai.deleteConversationsAfterDays', equals: [30, 90, 365] },
        default: 'ask',
      },
      {
        key: 'ai.maxLiveSessions',
        title: 'Maximum Live Agent Sessions',
        description:
          'How many agent conversations keep a live session, and its background process, open at ' +
          'once. Beyond this the least recently used is closed; it reopens on its next message.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '4', label: '4' },
            { value: '8', label: '8' },
            { value: '16', label: '16' },
            { value: '32', label: '32' },
            { value: '64', label: '64' },
            { value: '0', label: 'Unlimited' },
          ],
        },
        default: 16,
      },
      {
        key: 'ai.sendMessageWith',
        title: 'Send Message With',
        description: 'The key that sends a message. The other two insert a new line.',
        control: {
          kind: 'select',
          options: [
            { value: 'enter', label: 'Enter' },
            { value: 'mod-enter', label: `${MOD_LABEL}Enter` },
            { value: 'shift-enter', label: 'Shift+Enter' },
          ],
        },
        default: 'enter',
      },
      {
        key: 'ai.maxImagesPerMessage',
        title: 'Images per Message',
        description: "The most images one message can carry. A provider's own limit still applies.",
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '4', label: '4' },
            { value: '8', label: '8' },
            { value: '16', label: '16' },
          ],
        },
        default: 4,
      },
      {
        key: 'ai.maxImageSizeMb',
        title: 'Size per Image',
        description:
          "The largest image that can be attached. A provider's own limit still applies.",
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '4', label: '4 MB' },
            { value: '8', label: '8 MB' },
            { value: '16', label: '16 MB' },
          ],
        },
        default: 4,
      },
      {
        key: 'ai.expandToolCalls',
        title: 'Expand Tool Calls',
        description: 'Show each tool call open, with its input and output, rather than folded.',
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'ai.expandThinking',
        title: 'Expand Thinking',
        description: "Show the agent's reasoning open, rather than folded behind its label.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'ai.confirmDeleteConversations',
        title: 'Confirm Before Deleting Conversations',
        description: 'Ask before conversations are deleted from the conversation list.',
        control: { kind: 'toggle' },
        default: true,
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
    id: 'api-explorer',
    label: 'API Explorer',
    settings: [
      {
        key: 'apiExplorer.requestTimeoutSeconds',
        title: 'Request Timeout',
        description: "How long a request may take. A request's Settings tab can set its own.",
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '10', label: '10 Seconds' },
            { value: '30', label: '30 Seconds' },
            { value: '60', label: '1 Minute' },
            { value: '300', label: '5 Minutes' },
            { value: '0', label: 'No Limit' },
          ],
        },
        default: 30,
      },
      {
        key: 'apiExplorer.followRedirects',
        title: 'Follow Redirects',
        description:
          "Follow a redirect to where it leads. A request's Settings tab can say otherwise.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'apiExplorer.maxResponseMib',
        title: 'Maximum Response Size',
        description:
          'The most of a response body that is read. A longer one is cut there, and says so.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '8', label: '8 MiB' },
            { value: '32', label: '32 MiB' },
            { value: '128', label: '128 MiB' },
          ],
        },
        default: 32,
      },
      {
        key: 'apiExplorer.acceptSelfSigned',
        title: 'Accept Self-Signed Certificates',
        description:
          "Whose certificates are accepted without being verified: nobody's, this machine's, or everybody's.",
        control: {
          kind: 'select',
          options: [
            { value: 'never', label: 'Never' },
            { value: 'localhost', label: 'Localhost Only' },
            { value: 'always', label: 'Always' },
          ],
        },
        default: 'localhost',
      },
      {
        key: 'apiExplorer.proxyMode',
        title: 'Proxy',
        description:
          "How requests reach their servers: directly, through the system's proxy, or through your own. This machine is always reached directly.",
        control: {
          kind: 'select',
          options: [
            { value: 'none', label: 'None' },
            { value: 'system', label: 'System' },
            { value: 'custom', label: 'Custom' },
          ],
        },
        default: 'system',
      },
      {
        key: 'apiExplorer.proxyAddress',
        title: 'Proxy Address',
        description: 'The proxy to use, as host and port.',
        control: { kind: 'text', placeholder: 'proxy.example.com:8080' },
        visibleWhen: { key: 'apiExplorer.proxyMode', equals: ['custom'] },
        default: '',
      },
      {
        key: 'apiExplorer.proxyBypass',
        title: 'Proxy Bypass List',
        description:
          'The hosts to reach directly, separated by commas. *.example.com covers a domain.',
        control: { kind: 'text', placeholder: 'internal.example.com, *.corp.example.com' },
        visibleWhen: { key: 'apiExplorer.proxyMode', equals: ['custom'] },
        default: '',
      },
      {
        key: 'apiExplorer.historySize',
        title: 'History Size',
        description: 'How many sends the History panel keeps.',
        control: {
          kind: 'select',
          valueType: 'number',
          options: [
            { value: '50', label: '50' },
            { value: '100', label: '100' },
            { value: '250', label: '250' },
            { value: '500', label: '500' },
          ],
        },
        default: 100,
      },
      {
        key: 'apiExplorer.keepHistory',
        title: 'Keep History Across Sessions',
        description:
          "Keep a saved workspace's history when it closes. Response bodies are left out.",
        control: { kind: 'toggle' },
        default: false,
      },
      {
        key: 'apiExplorer.prettyPrintJson',
        title: 'Pretty-Print JSON',
        description: 'Lay a JSON response out with indentation.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'apiExplorer.wrapResponseBody',
        title: 'Wrap Response Body',
        description: 'Wrap long lines of a response body.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'apiExplorer.confirmDelete',
        title: 'Confirm Before Deleting',
        description: 'Ask before deleting a request, folder or environment.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'apiExplorer.sampleContent',
        title: 'Start New Workspaces With Sample Content',
        description:
          'Start a new workspace with a collection, a request and an environment to try.',
        control: { kind: 'toggle' },
        default: false,
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
      {
        key: 'plugins.notifyUpdates',
        title: 'Notify About Plugin Updates',
        description:
          'Say when a newer version of an installed plugin is available. Updates are never ' +
          'installed without you; the Plugin Manager always shows them.',
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'plugins.suggestPlugins',
        title: 'Suggest Plugins for Missing Support',
        description:
          'Offer a plugin when Studio meets something it cannot handle yet: a language without ' +
          "language support, a file it can't decode, a repository or containers with no plugin. " +
          "Each offer can also be turned off on its own with Don't Suggest This Again.",
        control: { kind: 'toggle' },
        default: true,
      },
      {
        key: 'plugins.dismissedSuggestions',
        title: 'Turned-Down Suggestions',
        description: "The plugin offers turned off with Don't Suggest This Again.",
        control: { kind: 'custom', component: 'plugin-suggestions-dismissed' },
        default: [],
      },
      {
        key: 'plugins.showUnsupported',
        title: 'Show Unsupported Plugins',
        description:
          'List plugins that publish no build for this computer in the Plugin Manager, marked Not ' +
          'Supported. Off hides them.',
        control: { kind: 'toggle' },
        default: true,
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    settings: [
      {
        key: 'privacy.confirmExternalLinks',
        title: 'Confirm Before Opening External Links',
        description:
          "Ask before a link opens in your browser: never, only for links in content Studio didn't " +
          'write (agent output, Markdown, web and server content), or always. ' +
          "Studio's own help links are trusted.",
        control: {
          kind: 'select',
          options: [
            { value: 'never', label: 'Never' },
            { value: 'untrusted', label: 'Untrusted Only' },
            { value: 'always', label: 'Always' },
          ],
        },
        default: 'never',
      },
      {
        key: 'security.imagePolicy',
        owner: 'security',
        title: 'Remote Images',
        description:
          'Which image sources content (such as markdown) may load. Restricting this reduces ' +
          'exposure to remote tracking and untrusted content. Takes effect the next time Studio ' +
          'starts.',
        control: {
          kind: 'select',
          options: [
            { value: 'local', label: 'Local only (safest)' },
            { value: 'https', label: 'HTTPS only (safe)' },
            { value: 'all', label: 'HTTP and HTTPS (less safe)' },
          ],
        },
      },
      {
        key: 'security.rememberedFileAccess',
        // Owned by the main process, which enforces it; drawn by its own row on the page.
        owner: 'security',
        title: 'Remembered File Access',
        description:
          'Files and folders you opened through a system dialog, which Studio reopens from the ' +
          'recent items without asking. Forget one and Studio asks again before reopening it.',
        control: { kind: 'custom', component: 'remembered-file-access' },
      },
    ],
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
  'code-highlighting',
  'code-editing',
  'code-saving',
  'code-suggestions',
  'code-find',
  'code-diffs',
  'code-language-servers',
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
