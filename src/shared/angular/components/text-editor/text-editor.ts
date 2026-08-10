import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
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
import { Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import { Theme } from '@shared/angular/services/theme/theme';
import { EditorZoom } from '@shared/angular/services/editor-zoom/editor-zoom';
import { Log } from '@shared/angular/services/log/log';

/**
 * Identifies the source label passed to Monaco when triggering editor actions on the caller's behalf.
 */
const COMMAND_SOURCE: string = 'app-text-editor';

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
   * Holds a value indicating whether the editor is ready for interaction.
   */
  private readonly editorReady: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds a value indicating whether the next model-content change should be ignored because it
   * originated from an external content update applied to the editor.
   */
  private ignoreNextChange: boolean = false;

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
      this.settings.textEditorAccentSelection();
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
      editor.updateOptions({
        lineNumbers: resolved.showLineNumbers ? 'on' : 'off',
        minimap: { enabled: resolved.showMinimap },
        renderLineHighlight: resolved.currentLineHighlight === 'filled' ? 'all' : 'line',
        wordWrap: resolved.wordWrap ? 'on' : 'off',
        stickyScroll: { enabled: resolved.stickyScroll },
        cursorBlinking: resolved.cursorBlinking,
        cursorSmoothCaretAnimation: resolved.cursorSmoothCaretAnimation,
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
      this.applyBracketColorization();
      this.monaco
        .getMonaco()
        ?.editor.setTheme(this.monaco.getThemeName(resolved.currentLineHighlight));
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
      if (editor.getValue() !== content) {
        this.ignoreNextChange = true;
        editor.setValue(content);
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
    this.bracketColorizationGuard?.dispose();
    this.bracketColorizationGuard = null;
    this.foldingPlaceholders?.dispose();
    this.foldingPlaceholders = null;
    if (this.editor !== null) {
      this.editor.dispose();
      this.editor = null;
    }
    this.modelUri = null;
    this.editorReady.set(false);
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
    const enabled: boolean = this.settings.resolveSettingsForLanguage(
      this.language(),
    ).colorBrackets;
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
   * Reveals and moves the caret to a position, then focuses the editor.
   * @param line The one-based line number.
   * @param column The one-based column number.
   */
  public reveal(line: number, column: number): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column });
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
   * Pastes the clipboard contents at the current selection, since Monaco has no paste trigger.
   */
  public paste(): void {
    const editor: MonacoApi.editor.IStandaloneCodeEditor | null = this.editor;
    if (editor === null) {
      return;
    }
    editor.focus();
    void navigator.clipboard
      .readText()
      .then((text: string): void => {
        const selection: MonacoApi.Selection | null = editor.getSelection();
        if (selection !== null) {
          editor.executeEdits(COMMAND_SOURCE, [{ range: selection, text, forceMoveMarkers: true }]);
        }
      })
      .catch((): void => undefined);
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
    this.createEditor();
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

    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    this.modelUri = model !== null ? model.uri.toString() : null;
    this.log.info('TextEditor', `Created editor for '${language}'`, this.modelUri);

    // Monaco's shared model service re-seeds every model's bracket-colouring option from the global
    // default (always on) whenever any editor's configuration changes, which would silently re-enable
    // colouring behind the setting's back. Re-assert the resolved value each time the model's options
    // change so the toggle sticks regardless of what triggered the re-seed.
    this.bracketColorizationGuard =
      model?.onDidChangeOptions((): void => this.applyBracketColorization()) ?? null;

    // Draw Visual-Studio-style collapsed-region placeholders (`signature {...}`). Harmless on editors
    // whose language has no brace folding — the controller simply finds no collapsed ranges.
    this.foldingPlaceholders = new FoldingPlaceholderController(monaco, this.editor);

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
      if (this.ignoreNextChange) {
        this.ignoreNextChange = false;
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
      this.selectionChange.emit(this.getSelectionText().trim().length > 0);
    });

    this.editorReady.set(true);
    this.ready.emit();
  }

  /**
   * Reads the editor model's end-of-line sequence.
   * @returns Returns 'CRLF' when the model uses CRLF, otherwise 'LF'.
   */
  private readEol(): TextEditorEol {
    return this.editor?.getModel()?.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  }
}
