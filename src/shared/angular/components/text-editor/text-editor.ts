import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  InputSignal,
  OnDestroy,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { FoldingPlaceholderController } from './folding-placeholder-controller';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import {
  AutoIndent,
  InlayHintsMode,
  Settings,
  TextEditorSettings,
} from '@shared/angular/services/settings/settings';
import { Theme } from '@shared/angular/services/theme/theme';
import { EditorZoom } from '@shared/angular/services/editor-zoom/editor-zoom';
import { editorAppearanceOptions } from '@shared/angular/services/monaco/editor-appearance-options';
import { editorSuggestOptions } from '@shared/angular/services/monaco/editor-suggest-options';
import { editorTypingOptions } from '@shared/angular/services/monaco/editor-typing-options';
import type { EditorConfigProperties } from '@shared/api/editor-config-channels';
import { parseRulers } from '@shared/angular/services/monaco/parse-rulers';
import { watchHeldModifier } from '@shared/angular/services/monaco/held-modifier';
import {
  BaseIndentation,
  fixesIndentation,
  indentationLabel,
  ResolvedIndentation,
  resolveIndentation,
} from './resolve-indentation';
import { Log } from '@shared/angular/services/log/log';
import { FindRouter } from '@shared/angular/services/find-router/find-router';
import { FIND_HOST, FindHost } from '@shared/angular/services/find-router/find-host';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import {
  REFERENCES_HOST,
  ReferencesHost,
} from '@shared/angular/services/references/reference-list';
import { ReferencesRouter } from '@shared/angular/services/references/references-router';
import { EditorContextMenu } from '@shared/angular/services/editor-context-menu/editor-context-menu';
import { EditorContextMenuHost } from '@shared/angular/components/editor-context-menu/editor-context-menu-host';
import { QuickFixes } from '@shared/angular/services/quick-fix/quick-fixes';
import { HoverCards } from '@shared/angular/services/hover/hover-cards';
import { ColourPickers } from '@shared/angular/services/colour-picker/colour-pickers';
import { Autocomplete } from '@shared/angular/services/autocomplete/autocomplete';
import { pasteIntoEditor } from './editor-paste';

/**
 * Identifies the source label passed to Monaco when triggering editor actions on the caller's behalf.
 */
const COMMAND_SOURCE: string = 'app-text-editor';

/**
 * Holds the wheel travel, in pixels, that makes one zoom step: one notch of a mouse wheel, or a short
 * trackpad pinch.
 */
const WHEEL_ZOOM_STEP: number = 40;

/**
 * Describes a run of lines, both ends included.
 */
export interface TextEditorLineRange {
  /**
   * Gets the first line, one-based.
   */
  readonly first: number;

  /**
   * Gets the last line, one-based.
   */
  readonly last: number;
}

/**
 * Describes a caret position reported to the host, as one-based line and column numbers.
 */
export interface TextEditorCursor {
  /**
   * Gets the one-based line number of the caret.
   */
  readonly line: number;

  /**
   * Gets the one-based column number of the caret.
   */
  readonly column: number;
}

/**
 * Identifies an editor model's end-of-line sequence.
 */
export type TextEditorEol = 'CRLF' | 'LF';

/**
 * Represents the shared text-editor pane: a single Monaco {@link MonacoApi.editor.IStandaloneCodeEditor}
 * instance bound to a content/language pair. It owns the editor instance and only the instance — its
 * creation and disposal, live settings/theme application, content and language synchronisation, and
 * caret/content/end-of-line reporting. It has no document model, no save state, no language-server
 * wiring, no change-margin gutter, no ribbon, and no panels: a composing feature view drives those by
 * binding the inputs, listening to the outputs, and reaching the instance through {@link getEditor}.
 */
@Component({
  selector: 'app-text-editor',
  imports: [EditorContextMenuHost],
  templateUrl: './text-editor.html',
  styleUrl: './text-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextEditor implements AfterViewInit, OnDestroy {
  /**
   * Holds the Monaco service used to load the engine and resolve options and themes.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the settings service supplying editor preferences.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the theme service supplying the resolved light/dark mode.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the global editor zoom, applied as a scale factor on the configured font size.
   */
  private readonly editorZoom: EditorZoom = inject(EditorZoom);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the find router this pane's editor is attached to, so Studio's ⌘F reaches the tab that
   * answers it (#1007).
   */
  private readonly findRouter: FindRouter = inject(FindRouter);

  /**
   * Holds the enclosing tab's own Find panel, or null when the pane sits in no such tab (a workspace
   * well document, where the Search panel answers instead).
   */
  private readonly findHost: FindHost | null = inject(FIND_HOST, { optional: true });

  /**
   * Holds the function that detaches this pane's editor from the find router, or null before creation
   * and after disposal.
   */
  private detachFind: (() => void) | null = null;

  /**
   * Holds the go-to router this pane's editor is attached to, so Studio's ⌘⇧O / ⌃G open Go to in
   * this pane's window (#1009).
   */
  private readonly goToRouter: GoToRouter = inject(GoToRouter);

  /**
   * Holds this pane's injector, which resolves the window it is drawn in — a popped-out dock's own —
   * so the quick-open box opens there.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the function that detaches this pane's editor from the go-to router, or null before
   * creation and after disposal.
   */
  private detachGoTo: (() => void) | null = null;

  /**
   * Holds the references router this pane's editor is attached to, so Find All References reaches the
   * tab that lists it (#1014).
   */
  private readonly referencesRouter: ReferencesRouter = inject(ReferencesRouter);

  /**
   * Holds the enclosing tab's own References panel, or null when the pane sits in no such tab (a
   * workspace well document, where the workspace's References panel answers instead).
   */
  private readonly referencesHost: ReferencesHost | null = inject(REFERENCES_HOST, {
    optional: true,
  });

  /**
   * Holds the function that detaches this pane's editor from the references router, or null before
   * creation and after disposal.
   */
  private detachReferences: (() => void) | null = null;

  /**
   * Holds the service this pane's editor is attached to for Studio's right-click menu (#1012).
   */
  private readonly contextMenu: EditorContextMenu = inject(EditorContextMenu);

  /**
   * Holds the component that draws the right-click menu in this pane's window.
   */
  private readonly contextMenuHost: Signal<EditorContextMenuHost> =
    viewChild.required<EditorContextMenuHost>(EditorContextMenuHost);

  /**
   * Holds the function that detaches this pane's editor from the right-click menu, or null before
   * creation and after disposal.
   */
  private detachContextMenu: (() => void) | null = null;

  /**
   * Holds the quick fixes this pane's editor draws its fix icon for (#1016).
   */
  private readonly quickFixes: QuickFixes = inject(QuickFixes);

  /**
   * Holds the function that takes this pane's fix icon away, or null before creation and after
   * disposal.
   */
  private detachQuickFixes: (() => void) | null = null;

  /**
   * Holds the hover cards this pane's editor shows in place of Monaco's hover (#1020).
   */
  private readonly hoverCards: HoverCards = inject(HoverCards);

  /**
   * Holds the function that takes this pane's hover card away, or null before creation and after
   * disposal.
   */
  private detachHoverCards: (() => void) | null = null;

  /**
   * Holds the colour pickers a click on this pane's colour swatches opens, in place of Monaco's (#1025).
   */
  private readonly colourPickers: ColourPickers = inject(ColourPickers);

  /**
   * Holds the function that detaches this pane's editor from the colour pickers, or null before
   * creation and after disposal.
   */
  private detachColourPickers: (() => void) | null = null;

  /**
   * Holds the completion list and signature card this pane's editor shows in place of Monaco's (#1021).
   */
  private readonly autocomplete: Autocomplete = inject(Autocomplete);

  /**
   * Holds the function that takes this pane's completion list and signature card away, or null before
   * creation and after disposal.
   */
  private detachAutocomplete: (() => void) | null = null;

  /**
   * Holds a reference to the element Monaco mounts into.
   */
  private readonly host: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('host');

  /**
   * Gets the editor's content. Setting it externally (for example after a reload) replaces the editor
   * text without raising {@link contentChange}.
   */
  public readonly content: InputSignal<string> = input<string>('');

  /**
   * Gets the editor's language identifier (for example `typescript`).
   */
  public readonly language: InputSignal<string> = input<string>('plaintext');

  /**
   * Gets a value indicating whether the editor rejects user edits. A read-only pane is still updated
   * through {@link content} and its imperative API — only interactive editing is blocked.
   */
  public readonly readOnly: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets editor options that override the settings-derived defaults. They are merged last — over both
   * the initial construction options and every live re-application — so a composing view can pin chrome
   * (for example hiding line numbers and the minimap on a disassembly listing) that would otherwise be
   * reset when the settings, theme, or zoom change. Pass a stable reference to avoid needless churn.
   */
  public readonly options: InputSignal<MonacoApi.editor.IEditorOptions> =
    input<MonacoApi.editor.IEditorOptions>({});

  /**
   * Gets the line ending a new document starts with (Default End of Line), or null for a file that
   * exists, which keeps its own. Applied once, when the editor is created, and only while the text has
   * no line break to say otherwise.
   */
  public readonly newDocumentEol: InputSignal<TextEditorEol | null> = input<TextEditorEol | null>(
    null,
  );

  /**
   * Gets a value indicating whether the pane belongs to the active tab. The active pane is laid out
   * and focused.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits once the Monaco editor instance has been created and its listeners are wired.
   */
  public readonly ready: OutputEmitterRef<void> = output<void>();

  /**
   * Emits the editor's text whenever the user edits it (not when {@link content} is set externally).
   */
  public readonly contentChange: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the caret position whenever it moves, and once when the editor is created.
   */
  public readonly cursorChange: OutputEmitterRef<TextEditorCursor> = output<TextEditorCursor>();

  /**
   * Emits whether the editor holds a non-empty selection whenever that changes, and once when the
   * editor is created. Reported rather than pulled so a control acting on the selection can offer
   * itself only when there is one.
   */
  public readonly selectionChange: OutputEmitterRef<boolean> = output<boolean>();

  /**
   * Emits the model's end-of-line sequence when it changes, and once when the editor is created.
   */
  public readonly eolChange: OutputEmitterRef<TextEditorEol> = output<TextEditorEol>();

  /**
   * Emits the label of the indentation in force whenever it changes.
   */
  public readonly indentationChange: OutputEmitterRef<string> = output<string>();

  /**
   * Gets what the file's `.editorconfig` says, which wins over the settings, or null for no file.
   */
  public readonly editorConfig: InputSignal<EditorConfigProperties | null> =
    input<EditorConfigProperties | null>(null);

  /**
   * Holds the Monaco editor instance, or null before creation and after disposal.
   */
  private editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

  /**
   * Holds the string form of the editor's model URI, or null before creation and after disposal.
   */
  private modelUri: string | null = null;

  /**
   * Holds the subscription that re-asserts the bracket-colouring setting whenever Monaco's shared
   * model service re-seeds the model's options from the global default, or null before creation and
   * after disposal.
   */
  private bracketColorizationGuard: MonacoApi.IDisposable | null = null;

  /**
   * Holds the controller drawing Visual-Studio-style collapsed-region placeholders (`signature {...}`),
   * or null before creation and after disposal.
   */
  private foldingPlaceholders: FoldingPlaceholderController | null = null;

  /**
   * Holds whether the open file was past Large File Feature Threshold when its content last arrived,
   * so the options re-apply when a load moves it across.
   */
  private readonly largeFile: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the modifier that shows inlay hints is held, for the While Holding choice.
   */
  private readonly inlayHintsHeld: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the indentation in force, re-asserted when Monaco's model service re-seeds the model; see
   * {@link applyIndentation}.
   */
  private indentation: ResolvedIndentation | null = null;

  /**
   * Gets a value indicating whether the pane has been torn down.
   */
  private destroyed: boolean = false;

  /**
   * Holds whether the model is being asked to read its indentation, which is no re-seed to undo.
   */
  private detectingIndentation: boolean = false;

  /**
   * Holds the Auto Indent the editor's cursor last took, or null before the first settings pass.
   */
  private cursorAutoIndent: AutoIndent | null = null;

  /**
   * Holds the wheel travel not yet turned into a zoom step: a trackpad reports it in many small moves.
   */
  private wheelZoomTravel: number = 0;

  /**
   * Holds the function that stops watching for the inlay hints modifier, or null when not watching.
   */
  private detachInlayHintsHold: (() => void) | null = null;

  /**
   * Holds the function that stops zooming with the wheel, or null when not listening.
   */
  private detachWheelZoom: (() => void) | null = null;

  /**
   * Holds a value indicating whether the editor is ready for interaction.
   */
  private readonly editorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether model-content changes should be ignored because they come from
   * an external content update being applied to the editor. Monaco raises them synchronously.
   */
  private ignoringChanges: boolean = false;

  /**
   * Holds the last content string this editor itself emitted, so its own edit echoed back through
   * the bound content is recognised by identity — without materialising and comparing the whole
   * document on every keystroke (multi-megabyte files paid several full scans per key).
   */
  private lastEmittedContent: string | null = null;

  /**
   * Initialises the pane, wiring effects for live settings/theme, external content updates, language
   * changes, and activation.
   */
  public constructor() {
    // Live settings/theme: re-resolve the editor options and theme for the current language. Reads the
    // accent-selection setting and the accent colour so a change to either re-registers the themes with
    // the new editor selection colour (#314) before the theme is re-applied below.
    effect((): void => {
      this.settings.textEditor();
      this.editorConfig();
      this.settings.textEditorAccentSelection();
      this.settings.value('textEditor.largeFileLineThreshold')();
      this.largeFile();
      this.theme.resolvedMode();
      this.theme.accent();
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (!this.editorReady() || editor === null) {
        return;
      }
      this.monaco.refreshThemes();
      const resolved: TextEditorSettings = this.settings.resolveSettingsForLanguage(
        this.language(),
      );
      const large: boolean = this.isLargeFile();
      editor.updateOptions({
        lineNumbers: resolved.showLineNumbers ? 'on' : 'off',
        minimap: { enabled: resolved.showMinimap && !large },
        // Past Large File Feature Threshold the heavier features go, so the file stays responsive.
        folding: !large,
        occurrencesHighlight: resolved.highlightOccurrences && !large ? 'singleFile' : 'off',
        selectionHighlight: resolved.selectionHighlight && !large,
        renderLineHighlight: resolved.currentLineHighlight === 'filled' ? 'all' : 'line',
        wordWrap: resolved.wordWrap ? 'on' : 'off',
        stickyScroll: { enabled: resolved.stickyScroll },
        formatOnType: resolved.formatOnType,
        formatOnPaste: resolved.formatOnPaste,
        cursorBlinking: resolved.cursorBlinking,
        ...this.monaco.motionOptions(resolved),
        ...editorAppearanceOptions(resolved),
        ...editorSuggestOptions(resolved),
        ...editorTypingOptions(resolved),
        rulers: this.rulers(resolved),
        tabSize: resolved.tabSize,
        insertSpaces: resolved.insertSpaces,
        detectIndentation: false,
        fontFamily: `"${resolved.fontFamily}", monospace`,
        fontSize: Math.round((resolved.fontSize * this.editorZoom.percent()) / 100),
        // The line height is a multiplier of the font size (0 = automatic), so it tracks the zoomed
        // font size Monaco derives it from without any extra scaling here.
        lineHeight: resolved.lineHeight,
        readOnly: this.readOnly(),
        // Merged last so a composing view's pinned chrome wins over the settings-derived defaults.
        ...this.options(),
      });
      this.applyAutoIndent(resolved.autoIndent);
      this.applyBracketColorization();
      this.applyIndentation();
      this.monaco
        .getMonaco()
        ?.editor.setTheme(this.monaco.getThemeName(resolved.currentLineHighlight));
    });

    // Inlay hints: apart from the rest, as the While Holding choice changes them on every key press.
    effect((): void => {
      const mode: InlayHintsMode = this.settings.resolveSettingsForLanguage(
        this.language(),
      ).inlayHints;
      const shown: boolean = mode === 'on' || (mode === 'while-holding' && this.inlayHintsHeld());
      if (this.editorReady()) {
        this.editor?.updateOptions({ inlayHints: { enabled: shown ? 'on' : 'off' } });
      }
    });

    // An `.editorconfig` line ending: converting the model is not an edit of the user's, so it dirties
    // nothing; the save writes it.
    effect((): void => {
      const eol: TextEditorEol | null = this.fixedEol();
      const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
      const model: MonacoApi.editor.ITextModel | null = this.editor?.getModel() ?? null;
      if (!this.editorReady() || eol === null || monaco === undefined || model === null) {
        return;
      }
      if (this.readEol() !== eol) {
        this.ignoringChanges = true;
        model.setEOL(
          eol === 'CRLF'
            ? monaco.editor.EndOfLineSequence.CRLF
            : monaco.editor.EndOfLineSequence.LF,
        );
        this.ignoringChanges = false;
      }
    });

    // External content: replace the editor text when the bound content differs, without echoing it
    // back through contentChange. The editor's own edit coming back around is recognised by string
    // identity first — the store passes the emitted string through unchanged — so the common
    // per-keystroke case skips the full-document read and compare entirely.
    effect((): void => {
      const content: string = this.content();
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (!this.editorReady() || editor === null) {
        return;
      }
      if (content === this.lastEmittedContent) {
        return;
      }
      if (!this.holdsContent(editor, content)) {
        this.ignoringChanges = true;
        this.replaceContent(editor, content);
        this.ignoringChanges = false;
        this.largeFile.set(this.isLargeFile());
        this.applyIndentation();
      }
      // The editor now holds this exact content, whichever branch ran; remembering it keeps the
      // echo-skip above truthful after an external update.
      this.lastEmittedContent = content;
    });

    // Language: retarget the model's language when the bound language changes.
    effect((): void => {
      const language: string = this.language();
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
      if (!this.editorReady() || editor === null || monaco === undefined) {
        return;
      }
      const model: MonacoApi.editor.ITextModel | null = editor.getModel();
      if (model !== null && model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
      }
    });

    // Activation: lay out and focus the editor when this pane becomes active.
    effect((): void => {
      const active: boolean = this.isActive();
      const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
      if (!this.editorReady() || editor === null || !active) {
        return;
      }
      editor.layout();
      editor.focus();
    });
  }

  /**
   * Loads Monaco if needed and creates the editor once the view's element is available.
   */
  public ngAfterViewInit(): void {
    void this.initEditor();
  }

  /**
   * Disposes the editor when the pane is torn down.
   */
  public ngOnDestroy(): void {
    this.log.info('TextEditor', 'Destroying editor pane', this.modelUri);
    this.destroyed = true;
    this.bracketColorizationGuard?.dispose();
    this.bracketColorizationGuard = null;
    this.foldingPlaceholders?.dispose();
    this.foldingPlaceholders = null;
    this.detachFind?.();
    this.detachFind = null;
    this.detachGoTo?.();
    this.detachGoTo = null;
    this.detachContextMenu?.();
    this.detachContextMenu = null;
    this.detachReferences?.();
    this.detachReferences = null;
    this.detachQuickFixes?.();
    this.detachQuickFixes = null;
    this.detachHoverCards?.();
    this.detachHoverCards = null;
    this.detachColourPickers?.();
    this.detachColourPickers = null;
    this.detachAutocomplete?.();
    this.detachAutocomplete = null;
    this.detachInlayHintsHold?.();
    this.detachInlayHintsHold = null;
    this.detachWheelZoom?.();
    this.detachWheelZoom = null;
    if (this.editor !== null) {
      this.editor.dispose();
      this.editor = null;
    }
    this.modelUri = null;
    this.editorReady.set(false);
  }

  /**
   * Starts zooming the editors as the wheel moves with ⌘ or Ctrl held. Listens ahead of Monaco, which
   * would otherwise scroll.
   * @param element The element the editor is in.
   * @returns Returns a function that stops listening.
   */
  private attachWheelZoom(element: HTMLElement): () => void {
    const listener: (event: WheelEvent) => void = (event: WheelEvent): void =>
      this.zoomWithWheel(event);
    element.addEventListener('wheel', listener, { capture: true, passive: false });
    return (): void => element.removeEventListener('wheel', listener, { capture: true });
  }

  /**
   * Zooms the editors with the wheel, when Mouse Wheel Zoom is on. Studio's own zoom rather than
   * Monaco's `mouseWheelZoom`, which would zoom past the level on the status strip. A trackpad pinch
   * arrives here too, as small moves with Ctrl set.
   * @param event The wheel event.
   */
  private zoomWithWheel(event: WheelEvent): void {
    if (!(event.metaKey || event.ctrlKey) || !this.settings.globalTextEditor().mouseWheelZoom) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.wheelZoomTravel += event.deltaY;
    if (Math.abs(this.wheelZoomTravel) >= WHEEL_ZOOM_STEP) {
      this.editorZoom.step(-this.wheelZoomTravel);
      this.wheelZoomTravel = 0;
    }
  }

  /**
   * Determines whether the open file is past Large File Feature Threshold.
   * @returns Returns true when it has more lines than the threshold.
   */
  private isLargeFile(): boolean {
    const lines: number = this.editor?.getModel()?.getLineCount() ?? 0;
    return lines > this.settings.get('textEditor.largeFileLineThreshold');
  }

  /**
   * Gets the line ending the file's `.editorconfig` fixes, or null when it leaves that alone. Monaco
   * has no bare CR, so `cr` fixes nothing.
   * @returns Returns the line ending, or null.
   */
  private fixedEol(): TextEditorEol | null {
    const endOfLine: string | undefined = this.editorConfig()?.endOfLine;
    return endOfLine === 'lf' ? 'LF' : endOfLine === 'crlf' ? 'CRLF' : null;
  }

  /**
   * Resolves the rulers in force: `max_line_length` wins over the Rulers setting.
   * @param resolved The code settings in force.
   * @returns Returns the columns.
   */
  private rulers(resolved: TextEditorSettings): number[] {
    const length: number | 'off' | undefined = this.editorConfig()?.maxLineLength;
    return length === undefined
      ? [...parseRulers(resolved.rulers)]
      : length === 'off'
        ? []
        : [length];
  }

  /**
   * Determines whether the editor already holds a text. Under a fixed line ending the model may have
   * been converted ahead of the document, which only takes the new endings on save, so the endings
   * alone are no difference.
   * @param editor The editor.
   * @param content The text.
   * @returns Returns true when there is nothing to replace.
   */
  private holdsContent(editor: MonacoApi.editor.IStandaloneCodeEditor, content: string): boolean {
    const current: string = editor.getValue();
    return this.fixedEol() === null
      ? current === content
      : current.replace(/\r\n/g, '\n') === content.replace(/\r\n/g, '\n');
  }

  /**
   * Replaces the editor's text where it stands, so a save that changed it (or a reload) keeps the
   * caret, the scroll position and the undo history that `setValue` would throw away.
   * @param editor The editor.
   * @param content The new text.
   */
  private replaceContent(editor: MonacoApi.editor.IStandaloneCodeEditor, content: string): void {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (model === null || monaco === undefined) {
      editor.setValue(content);
      return;
    }
    const view: MonacoApi.editor.ICodeEditorViewState | null = editor.saveViewState();
    model.pushEditOperations(
      null,
      [{ range: model.getFullModelRange(), text: content }],
      (): null => null,
    );
    if (content.includes('\n')) {
      const eol: TextEditorEol = this.fixedEol() ?? (content.includes('\r\n') ? 'CRLF' : 'LF');
      model.setEOL(
        eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
      );
    }
    if (view !== null) {
      editor.restoreViewState(view);
    }
  }

  /**
   * Resolves the indentation in force and puts it on the model. It goes on the model because that is
   * what a formatter is asked with, and because `tabSize` given to `updateOptions` lands in
   * configuration shared by a Monaco instance's editors, which cannot hold a value per file. Monaco's
   * own `detectIndentation` lives there too, so reading the content is done here, per model.
   */
  private applyIndentation(): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor?.getModel() ?? null;
    if (model === null) {
      return;
    }
    const resolved: TextEditorSettings = this.settings.resolveSettingsForLanguage(this.language());
    const config: EditorConfigProperties | null = this.editorConfig();
    let detected: BaseIndentation | null = null;
    if (resolved.detectIndentation && !fixesIndentation(config)) {
      this.detectingIndentation = true;
      model.detectIndentation(resolved.insertSpaces, resolved.tabSize);
      this.detectingIndentation = false;
      detected = model.getOptions();
    }
    this.indentation = resolveIndentation(resolved, detected, config);
    this.assertIndentation();
    this.indentationChange.emit(indentationLabel(this.indentation));
  }

  /**
   * Writes the resolved indentation to the model, only when it differs so the guard cannot recurse.
   */
  private assertIndentation(): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor?.getModel() ?? null;
    const wanted: ResolvedIndentation | null = this.indentation;
    if (model === null || wanted === null) {
      return;
    }
    const { tabSize, indentSize, insertSpaces }: MonacoApi.editor.TextModelResolvedOptions =
      model.getOptions();
    if (
      tabSize !== wanted.tabSize ||
      indentSize !== wanted.indentSize ||
      insertSpaces !== wanted.insertSpaces
    ) {
      model.updateOptions(wanted);
    }
  }

  /**
   * Makes a change of Auto Indent reach typing. The cursor keeps its own copy of the options, rebuilt
   * only when one of a fixed list changes, and Monaco's list leaves `autoIndent` out: the option alone
   * would read as changed while Enter went on indenting the old way. Moving a listed option there and
   * back, one that does nothing until a bracket is deleted, rebuilds the copy.
   * @param autoIndent The Auto Indent now in force.
   */
  private applyAutoIndent(autoIndent: AutoIndent): void {
    const previous: AutoIndent | null = this.cursorAutoIndent;
    this.cursorAutoIndent = autoIndent;
    if (previous !== null && previous !== autoIndent) {
      this.editor?.updateOptions({ autoClosingDelete: 'never' });
      this.editor?.updateOptions({ autoClosingDelete: 'auto' });
    }
  }

  /**
   * Applies the current "coloured brackets" setting to the editor's model. Bracket-pair colourisation
   * is a model option — the per-editor `bracketPairColorization` option is a no-op in standalone
   * Monaco — so the resolved value is written to the model directly, and only when it differs so the
   * self-healing guard cannot recurse.
   */
  private applyBracketColorization(): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor?.getModel() ?? null;
    if (model === null) {
      return;
    }
    const enabled: boolean =
      this.settings.resolveSettingsForLanguage(this.language()).colorBrackets &&
      !this.isLargeFile();
    if (model.getOptions().bracketPairColorizationOptions.enabled === enabled) {
      return;
    }
    model.updateOptions({
      bracketColorizationOptions: { enabled, independentColorPoolPerBracketType: false },
    });
  }

  /**
   * Gets the underlying Monaco editor instance, or null before creation and after disposal. The host
   * uses it to attach editor-instance features (such as a change-margin gutter).
   * @returns Returns the editor instance, or null.
   */
  public getEditor(): MonacoApi.editor.IStandaloneCodeEditor | null {
    return this.editor;
  }

  /**
   * Gets the editor's text model, or null before creation and after disposal.
   * @returns Returns the model, or null.
   */
  public getModel(): MonacoApi.editor.ITextModel | null {
    return this.editor?.getModel() ?? null;
  }

  /**
   * Gets the string form of the editor's model URI, or null before creation and after disposal. The
   * host uses it to register the editor with the model-URI registry.
   * @returns Returns the model URI, or null.
   */
  public getModelUri(): string | null {
    return this.modelUri;
  }

  /**
   * Gets the editor's current text.
   * @returns Returns the text, or the empty string before creation.
   */
  public getValue(): string {
    return this.editor?.getValue() ?? '';
  }

  /**
   * Gets the text of the editor's current selection.
   * @returns Returns the selected text, or an empty string when nothing is selected.
   */
  public getSelectionText(): string {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    const selection: MonacoApi.Selection | null = editor?.getSelection() ?? null;
    if (editor === null || model === null || selection === null || selection.isEmpty()) {
      return '';
    }
    return model.getValueInRange(selection);
  }

  /**
   * Focuses the editor.
   */
  public focus(): void {
    this.editor?.focus();
  }

  /**
   * Re-lays out the editor to its container size. Called by the host after layout changes (such as a
   * docked panel opening or resizing).
   */
  public layout(): void {
    this.editor?.layout();
  }

  /**
   * Reveals and moves the caret to a position — or selects a span on its line, as a search match —
   * centred, then focuses the editor.
   * @param line The one-based line number.
   * @param column The one-based column number.
   * @param endColumn The one-based column the selection ends at on the line, or undefined to place
   * the caret alone.
   */
  public reveal(line: number, column: number, endColumn?: number): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }
    // Measured first: a tab just brought forward has not been laid out since it was hidden, and a line
    // centred in a viewport of no height lands at the top once the editor is shown.
    editor.layout();
    editor.revealLineInCenter(line);
    if (endColumn === undefined) {
      editor.setPosition({ lineNumber: line, column });
    } else {
      editor.setSelection({
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn,
      });
    }
    editor.focus();
  }

  /**
   * Focuses the editor and triggers a built-in Monaco action (for example `editor.action.formatDocument`).
   * @param action The Monaco action identifier.
   */
  public trigger(action: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }
    editor.focus();
    editor.trigger(COMMAND_SOURCE, action, null);
  }

  /**
   * Runs a built-in Monaco action and waits for it to finish, so actions that must be sequenced (for
   * example organising imports before formatting) can be chained. Unlike {@link trigger}, this
   * resolves the action through the editor's action registry, so an action the editor does not
   * provide resolves without running anything rather than being dispatched blindly.
   * @param action The Monaco action identifier.
   * @returns Returns a promise that completes when the action has run.
   */
  public async runAction(action: string): Promise<void> {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }
    editor.focus();
    await editor.getAction(action)?.run();
  }

  /**
   * Runs an editor action for a save, leaving the focus where it is: a save may come from elsewhere,
   * for another document's editor, and what the user is doing must not be taken from them.
   * @param action The action identifier.
   * @returns Returns a promise that resolves once the action has finished.
   */
  public async runActionForSave(action: string): Promise<void> {
    await this.editor?.getAction(action)?.run();
  }

  /**
   * Formats lines for a save, with the formatter for a selection: one that cannot format part of a
   * file offers no such action, and the lines stay as they are. The caret and scroll position stay
   * too, as the selection is only how the action is told what to format.
   * @param ranges The lines to format, last first, so formatting one leaves the next where it is.
   * @returns Returns a promise that resolves once they are formatted.
   */
  public async formatLinesForSave(ranges: readonly TextEditorLineRange[]): Promise<void> {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null || ranges.length === 0) {
      return;
    }
    const view: MonacoApi.editor.ICodeEditorViewState | null = editor.saveViewState();
    try {
      for (const range of ranges) {
        editor.setSelection({
          startLineNumber: range.first,
          startColumn: 1,
          endLineNumber: range.last,
          endColumn: model.getLineMaxColumn(range.last),
        });
        await editor.getAction('editor.action.formatSelection')?.run();
      }
    } finally {
      // A formatter that fails must not leave the user's caret as the selection it was handed.
      if (view !== null) {
        editor.restoreViewState(view);
      }
    }
  }

  /**
   * Pastes the clipboard contents at the current selection, since Monaco has no paste trigger.
   */
  public paste(): void {
    if (this.editor !== null) {
      pasteIntoEditor(this.editor, COMMAND_SOURCE);
    }
  }

  /**
   * Replaces the editor's full contents as a single undoable edit.
   * @param text The new text.
   */
  public replaceAll(text: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null) {
      return;
    }
    editor.executeEdits(COMMAND_SOURCE, [{ range: model.getFullModelRange(), text }]);
  }

  /**
   * Replaces a character-offset range of the editor's contents as a single undoable edit, leaving the
   * rest of the document (and its undo history) untouched. A zero-length range inserts.
   * @param start The first character offset of the range.
   * @param length The number of characters to replace.
   * @param text The replacement text.
   */
  public replaceRange(start: number, length: number, text: string): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null) {
      return;
    }
    const from: MonacoApi.Position = model.getPositionAt(start);
    const to: MonacoApi.Position = model.getPositionAt(start + length);
    const range: MonacoApi.IRange = {
      startLineNumber: from.lineNumber,
      startColumn: from.column,
      endLineNumber: to.lineNumber,
      endColumn: to.column,
    };
    // Consecutive executeEdits calls merge into one undo group without explicit stops; each agent
    // edit must undo on its own.
    editor.pushUndoStop();
    editor.executeEdits(COMMAND_SOURCE, [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
  }

  /**
   * Awaits the Monaco load, then creates the editor.
   * @returns Returns a promise that resolves once the editor has been created.
   */
  private async initEditor(): Promise<void> {
    await this.monaco.ensureLoaded();
    // A tab closed during the first load is gone, and nothing would ever dispose an editor made for it.
    if (!this.destroyed) {
      this.createEditor();
    }
  }

  /**
   * Creates the Monaco editor for the bound content and language.
   */
  private createEditor(): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      this.log.warn('TextEditor', 'Monaco unavailable; editor not created');
      return;
    }

    const language: string = this.language();
    this.editor = monaco.editor.create(this.host().nativeElement, {
      ...this.monaco.getEditorOptions(language),
      readOnly: this.readOnly(),
      // Merged before value/language so a composing view's pinned chrome wins, but cannot clobber the
      // seeded content or language.
      ...this.options(),
      value: this.content(),
      language,
    });

    const element: HTMLElement = this.host().nativeElement;
    this.detachInlayHintsHold = watchHeldModifier(
      element.ownerDocument.defaultView ?? window,
      (held: boolean): void => this.inlayHintsHeld.set(held),
    );
    this.detachWheelZoom = this.attachWheelZoom(element);

    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    this.modelUri = model !== null ? model.uri.toString() : null;
    const eol: TextEditorEol | null = this.newDocumentEol();
    if (model !== null && eol !== null && !/[\r\n]/.test(model.getValue())) {
      model.setEOL(
        eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
      );
    }
    this.log.info('TextEditor', `Created editor for '${language}'`, this.modelUri);

    // Monaco's shared model service re-seeds every model's bracket-colouring option from the global
    // default (always on) whenever any editor's configuration changes, which would silently re-enable
    // colouring behind the setting's back. Re-assert the resolved value each time the model's options
    // change so the toggle sticks regardless of what triggered the re-seed.
    this.bracketColorizationGuard =
      model?.onDidChangeOptions((): void => {
        this.applyBracketColorization();
        if (!this.detectingIndentation) {
          this.assertIndentation();
        }
      }) ?? null;

    // Draw Visual-Studio-style collapsed-region placeholders (`signature {...}`). Harmless on editors
    // whose language has no brace folding — the controller simply finds no collapsed ranges.
    this.foldingPlaceholders = new FoldingPlaceholderController(monaco, this.editor);

    // Hand the editor to the find router with the tab whose Find panel answers it outside a workspace.
    this.detachFind = this.findRouter.attach(this.editor, { host: this.findHost });
    this.detachGoTo = this.goToRouter.attach(this.editor, { injector: this.injector });
    this.detachReferences = this.referencesRouter.attach(this.editor, this.referencesHost);
    // Right-clicks open Studio's menu, drawn by the host in this pane's view — so in its window.
    this.detachContextMenu = this.contextMenu.attach(this.editor, this.contextMenuHost());
    // Studio's fix icon beside the caret's line while fixes exist there; hidden while read-only.
    this.detachQuickFixes = this.quickFixes.attach(this.editor, monaco);
    // Studio's hover card over a symbol, a problem or a breakpoint, drawn in this pane's window.
    this.detachHoverCards = this.hoverCards.attach(this.editor, this.injector);
    // Studio's colour picker when a colour swatch is clicked, drawn in this pane's window.
    this.detachColourPickers = this.colourPickers.attach(this.editor, this.injector);
    // Studio's completion list and signature card at the caret, drawn in this pane's window.
    this.detachAutocomplete = this.autocomplete.attach(this.editor, this.injector);

    // Seed the caret and end-of-line before any edit, so the host's status is correct on first show.
    const seed: MonacoApi.Position | null = this.editor.getPosition();
    this.cursorChange.emit(
      seed === null ? { line: 1, column: 1 } : { line: seed.lineNumber, column: seed.column },
    );
    this.eolChange.emit(this.readEol());
    this.selectionChange.emit(false);

    this.editor.onDidChangeModelContent((): void => {
      // The end-of-line sequence can change with content (for example a "Change EOL" edit).
      this.eolChange.emit(this.readEol());
      if (this.ignoringChanges) {
        return;
      }
      const value: string = this.editor?.getValue() ?? '';
      this.lastEmittedContent = value;
      this.contentChange.emit(value);
    });

    this.editor.onDidChangeCursorPosition(
      (event: MonacoApi.editor.ICursorPositionChangedEvent): void => {
        this.cursorChange.emit({ line: event.position.lineNumber, column: event.position.column });
      },
    );

    // Only whether there IS a selection is reported, not what it holds: the text is pulled on demand
    // by whoever acts on it, and a selection can be large enough that carrying it on every keystroke
    // would be waste. Whitespace alone does not count, matching what an attach would actually take.
    this.editor.onDidChangeCursorSelection((): void => {
      this.selectionChange.emit(this.selectionHasText());
    });

    this.largeFile.set(this.isLargeFile());
    this.editorReady.set(true);
    this.ready.emit();
  }

  /**
   * Converts the document's line endings, as an edit the user can undo; the content change that
   * follows marks the document edited.
   * @param eol The line ending to use.
   */
  public setEol(eol: TextEditorEol): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    const model: MonacoApi.editor.ITextModel | null | undefined = this.editor?.getModel();
    if (monaco === undefined || model === null || model === undefined || this.readEol() === eol) {
      return;
    }
    model.pushEOL(
      eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
    );
    this.log.debug('TextEditor', `Converted line endings to ${eol}`, this.modelUri);
  }

  /**
   * Reads the editor model's end-of-line sequence.
   * @returns Returns 'CRLF' when the model uses CRLF, otherwise 'LF'.
   */
  private readEol(): TextEditorEol {
    return this.editor?.getModel()?.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  }

  /**
   * Determines whether the selection holds any non-whitespace text — without materialising it. This
   * runs on every selection change, which fires per keystroke and per pointer event during a
   * drag-select; copying the selection out of the model to answer a yes/no question cost O(selection
   * bytes) each time (exactly the waste the emit above promises to avoid). Lines are scanned in
   * place with an early exit, so a selection that starts with text answers from its first line.
   * @returns Returns true when the selection contains non-whitespace text.
   */
  private selectionHasText(): boolean {
    const selection: MonacoApi.Selection | null = this.editor?.getSelection() ?? null;
    const model: MonacoApi.editor.ITextModel | null = this.editor?.getModel() ?? null;
    if (selection === null || model === null || selection.isEmpty()) {
      return false;
    }
    for (let line: number = selection.startLineNumber; line <= selection.endLineNumber; line += 1) {
      const content: string = model.getLineContent(line);
      const from: number = line === selection.startLineNumber ? selection.startColumn - 1 : 0;
      const to: number =
        line === selection.endLineNumber ? selection.endColumn - 1 : content.length;
      if (content.slice(from, to).trim().length > 0) {
        return true;
      }
    }
    return false;
  }
}
