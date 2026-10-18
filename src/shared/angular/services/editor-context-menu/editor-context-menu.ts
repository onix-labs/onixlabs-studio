import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type { MenuItem } from '@shared/angular/components/menu/menu';
import { pasteIntoEditor } from '@shared/angular/components/text-editor/editor-paste';
import { EditorLocation, Editors } from '@shared/angular/services/editors/editors';
import { FindRouter } from '@shared/angular/services/find-router/find-router';
import { revealTarget } from '@shared/angular/services/go-to/go-to-model';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import { Log } from '@shared/angular/services/log/log';
import { LspDefinition, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import {
  hasComments,
  hasDefinitionProvider,
  providedDefinitions,
} from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { Studio } from '@shared/angular/services/studio/studio';

/**
 * Identifies the source label passed to Monaco when the menu runs an editor action.
 */
const COMMAND_SOURCE: string = 'app-editor-context-menu';

/**
 * Names each command the editor's right-click menu offers; each is also the row's identifier.
 */
export type EditorContextMenuCommand =
  | 'definition'
  | 'symbol'
  | 'line'
  | 'find'
  | 'formatDocument'
  | 'formatSelection'
  | 'comment'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll';

/**
 * Holds the Monaco mouse-target types a right-click opens the menu over — the text, the empty space
 * after it, and the hidden input — numbered as Monaco's `MouseTargetType` numbers them (`TEXTAREA`,
 * `CONTENT_TEXT`, `CONTENT_EMPTY`). Monaco's own menu opened over exactly these: never over the
 * gutter, a scroll bar, the minimap or a widget drawn over the text.
 */
const MENU_TARGETS: ReadonlySet<number> = new Set<number>([1, 6, 7]);

/**
 * Holds how long to wait between looks for an opened file's editor, in milliseconds.
 */
const REVEAL_POLL_MS: number = 80;

/**
 * Holds how many times to look for an opened file's editor before giving up (two seconds in all).
 */
const REVEAL_POLL_ATTEMPTS: number = 25;

/**
 * Maps the Monaco actions the menu runs to the commands that run them.
 */
const MONACO_ACTIONS: Readonly<Partial<Record<EditorContextMenuCommand, string>>> = {
  formatDocument: 'editor.action.formatDocument',
  formatSelection: 'editor.action.formatSelection',
  comment: 'editor.action.commentLine',
  cut: 'editor.action.clipboardCutAction',
  copy: 'editor.action.clipboardCopyAction',
  selectAll: 'editor.action.selectAll',
};

/**
 * Describes the shortcut hint each command shows, per platform. Hints are text only: each chord is
 * served where it already is — Monaco's own bindings, Studio's find and go-to commands, the core
 * menu's native editing roles — and nothing here binds one (the editing-chords rule).
 */
interface ShortcutHints {
  /**
   * Gets the hint on macOS.
   */
  readonly mac: string;

  /**
   * Gets the hint on Windows (and in a browser).
   */
  readonly windows: string;

  /**
   * Gets the hint on Linux, where it differs from Windows.
   */
  readonly linux?: string;
}

/**
 * Holds the shortcut hint of each command that has one.
 */
const SHORTCUTS: Readonly<Record<EditorContextMenuCommand, ShortcutHints>> = {
  definition: { mac: 'F12', windows: 'F12' },
  symbol: { mac: '⌘⇧O', windows: 'Ctrl+Shift+O' },
  line: { mac: '⌃G', windows: 'Ctrl+G' },
  find: { mac: '⌘F', windows: 'Ctrl+F' },
  // Monaco's own chords: Linux gives Format Document a chord of its own.
  formatDocument: { mac: '⌥⇧F', windows: 'Shift+Alt+F', linux: 'Ctrl+Shift+I' },
  formatSelection: { mac: '⌘K ⌘F', windows: 'Ctrl+K Ctrl+F' },
  comment: { mac: '⌘/', windows: 'Ctrl+/' },
  cut: { mac: '⌘X', windows: 'Ctrl+X' },
  copy: { mac: '⌘C', windows: 'Ctrl+C' },
  paste: { mac: '⌘V', windows: 'Ctrl+V' },
  selectAll: { mac: '⌘A', windows: 'Ctrl+A' },
};

/**
 * Describes one right-click: the editor it was in and the rows its menu shows, built as it opened.
 */
export interface EditorContextMenuSubject {
  /**
   * Gets the editor the menu acts on.
   */
  readonly editor: MonacoApi.editor.ICodeEditor;

  /**
   * Gets the menu's rows.
   */
  readonly items: readonly MenuItem[];
}

/**
 * Opens the menu for a right-click, at the pointer, in the window the editor is drawn in. Supplied by
 * the component that hosts the menu beside the editor.
 */
export interface EditorContextMenuOpener {
  /**
   * Opens the menu.
   * @param event The right-click, which places the menu and is consumed by it.
   * @param subject The editor and the rows to show.
   */
  open(event: MouseEvent, subject: EditorContextMenuSubject): void;
}

/**
 * Builds and runs Studio's right-click menu in every editor (#1012). Monaco's own context menu is off
 * (#1009); the shared text and diff editors attach their editors here, as they attach them to the
 * find and go-to routers, with the component that draws the shared menu in their window.
 *
 * A right-click over the text moves the caret there when it falls outside the selection, as Monaco
 * does, then opens the menu with the rows that editor can use: Go to Definition where its language
 * offers definitions, Go to Symbol and Go to Line, Find where a find panel answers, Format and Toggle
 * Comment where the language supports them and the editor can be edited, and the clipboard — Copy and
 * Select All alone in a read-only editor.
 *
 * Editors nobody attached — a markdown document's code fences — keep their own right-click.
 */
@Service()
export class EditorContextMenu {
  /**
   * Holds the find router Find goes through.
   */
  private readonly findRouter: FindRouter = inject(FindRouter);

  /**
   * Holds the go-to router Go to Symbol and Go to Line go through.
   */
  private readonly goToRouter: GoToRouter = inject(GoToRouter);

  /**
   * Holds the editor registry, which knows the file each document editor shows.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the host platform, which decides the shortcut hints.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the injector the language-server features are resolved from as they are needed. Resolved
   * then rather than injected here: they reach into Monaco, which every editor would otherwise pull in
   * to be built.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the function that opens a file in the workspace, or null until the workspace feature
   * contributes it — outside a workspace, nothing can open another file.
   */
  private openFile: ((path: string) => Promise<boolean>) | null = null;

  /**
   * Sets how a definition in another file is opened, called once by the workspace feature at start-up.
   * A seam rather than an injection: the workspace's file opener reaches the diff panels, whose diff
   * editor attaches here, so importing it would be a cycle.
   * @param openFile Opens a file by absolute path, resolving whether it opened.
   */
  public useFileOpener(openFile: (path: string) => Promise<boolean>): void {
    this.openFile = openFile;
  }

  /**
   * Attaches an editor: its right-clicks open the menu through the given opener.
   * @param editor The Monaco editor.
   * @param opener Opens the menu in the editor's window.
   * @returns Returns a function that detaches the editor.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, opener: EditorContextMenuOpener): () => void {
    const subscription: MonacoApi.IDisposable = editor.onContextMenu(
      (event: MonacoApi.editor.IEditorMouseEvent): void =>
        this.onContextMenu(editor, event, opener),
    );
    return (): void => subscription.dispose();
  }

  /**
   * Builds the rows for an editor as it stands: what it can do, given whether it can be edited, what
   * its language supports, and what is selected.
   * @param editor The editor.
   * @returns Returns the rows, grouped by separators.
   */
  public itemsFor(editor: MonacoApi.editor.ICodeEditor): readonly MenuItem[] {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null) {
      return [];
    }
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    const language: string = model.getLanguageId();
    const writable: boolean = !this.isReadOnly(editor, monaco);
    const selected: boolean = editor.getSelection()?.isEmpty() === false;

    const navigation: MenuItem[] = [];
    if (this.offersDefinitions(model, monaco)) {
      navigation.push(this.item('definition', 'Go to Definition'));
    }
    navigation.push(this.item('symbol', 'Go to Symbol…'), this.item('line', 'Go to Line…'));

    const find: MenuItem[] = [this.item('find', 'Find…', !this.findRouter.answers(editor))];

    // Hidden, not disabled, in a read-only editor: it can never be edited, so the rows are noise.
    const editing: MenuItem[] = [];
    if (writable && supports(editor, 'formatDocument')) {
      editing.push(this.item('formatDocument', 'Format Document'));
    }
    if (writable && supports(editor, 'formatSelection')) {
      editing.push(this.item('formatSelection', 'Format Selection', !selected));
    }
    if (writable && monaco !== undefined && hasComments(monaco, language)) {
      editing.push(this.item('comment', 'Toggle Comment'));
    }

    const clipboard: MenuItem[] = writable
      ? [
          this.item('cut', 'Cut'),
          this.item('copy', 'Copy'),
          this.item('paste', 'Paste'),
          this.item('selectAll', 'Select All'),
        ]
      : [this.item('copy', 'Copy'), this.item('selectAll', 'Select All')];

    return [navigation, find, editing, clipboard]
      .filter((group: readonly MenuItem[]): boolean => group.length > 0)
      .flatMap((group: readonly MenuItem[], index: number): readonly MenuItem[] =>
        index === 0 ? group : [{ id: `separator-${index}`, label: '', separator: true }, ...group],
      );
  }

  /**
   * Runs a chosen row's command on an editor.
   * @param command The row's identifier.
   * @param editor The editor the menu was opened in.
   */
  public run(command: string, editor: MonacoApi.editor.ICodeEditor): void {
    this.log.debug('editorContextMenu', 'Run', command);
    switch (command as EditorContextMenuCommand) {
      case 'definition':
        void this.goToDefinition(editor);
        return;
      case 'symbol':
        this.goToRouter.open(editor, 'symbol');
        return;
      case 'line':
        this.goToRouter.open(editor, 'line');
        return;
      case 'find':
        this.findRouter.openFromEditor(editor, 'find');
        return;
      case 'paste':
        pasteIntoEditor(editor, COMMAND_SOURCE);
        return;
      case 'cut':
      case 'copy':
      case 'selectAll':
        // The strip's Cut and Copy buttons trigger the same actions, so the two behave alike.
        editor.focus();
        editor.trigger(
          COMMAND_SOURCE,
          MONACO_ACTIONS[command as EditorContextMenuCommand] ?? '',
          null,
        );
        return;
      case 'formatDocument':
      case 'formatSelection':
      case 'comment':
        // Run through the action registry: formatting is asynchronous, and none of these opens a
        // widget of Monaco's.
        editor.focus();
        void editor.getAction(MONACO_ACTIONS[command as EditorContextMenuCommand] ?? '')?.run();
        return;
      default:
        this.log.warn('editorContextMenu', 'Unknown command', command);
    }
  }

  /**
   * Goes to the definition of the symbol at the caret — straight there, the first when there are
   * several — never through Monaco's peek. A language server's answer comes first, by path, so a
   * definition in a file not yet open is opened; otherwise the definition providers Monaco's own
   * languages register answer, within the files Studio has open.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the definition is shown, or found not to be.
   */
  public async goToDefinition(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const position: MonacoApi.Position | null = editor.getPosition();
    if (model === null || position === null) {
      return;
    }
    const served: readonly LspDefinition[] | null = await this.injector
      .get(LspFeatures)
      .definitions(model, position);
    if (served !== null) {
      const first: LspDefinition | undefined = served[0];
      if (first === undefined) {
        this.log.debug('editorContextMenu', 'The language server knows no definition');
        return;
      }
      await this.goTo(editor, first.path, first.range);
      return;
    }
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    const provided: readonly MonacoApi.languages.Location[] =
      monaco === undefined ? [] : await providedDefinitions(monaco, model, position);
    const first: MonacoApi.languages.Location | undefined = provided[0];
    if (first === undefined) {
      this.log.debug('editorContextMenu', 'No provider knows a definition', model.getLanguageId());
      return;
    }
    if (first.uri.toString() === model.uri.toString()) {
      revealTarget(editor, startOf(first.range));
      return;
    }
    const path: string | null = this.editors.locate(first.uri.toString())?.path ?? null;
    if (path === null) {
      this.log.debug('editorContextMenu', 'The definition is in no file Studio can open');
      return;
    }
    await this.goTo(editor, path, first.range);
  }

  /**
   * Handles a right-click in an attached editor: over the text, it moves the caret to the click when
   * the click falls outside the selection, and opens the menu.
   * @param editor The editor.
   * @param event Monaco's mouse event.
   * @param opener Opens the menu in the editor's window.
   */
  private onContextMenu(
    editor: MonacoApi.editor.ICodeEditor,
    event: MonacoApi.editor.IEditorMouseEvent,
    opener: EditorContextMenuOpener,
  ): void {
    if (!MENU_TARGETS.has(event.target.type) || editor.getModel() === null) {
      return;
    }
    editor.focus();
    const position: MonacoApi.Position | null = event.target.position;
    const selection: MonacoApi.Selection | null = editor.getSelection();
    // A click inside the selection keeps it, so the menu acts on what was selected — Copy, Format
    // Selection; anywhere else is where the user means, as a left-click would be.
    if (position !== null && selection?.containsPosition(position) !== true) {
      editor.setPosition(position);
    }
    opener.open(event.event.browserEvent, { editor, items: this.itemsFor(editor) });
  }

  /**
   * Builds one row, with its shortcut hint for this platform.
   * @param command The command, which is the row's identifier.
   * @param label The row's label.
   * @param disabled Whether the row is shown but inert.
   * @returns Returns the row.
   */
  private item(
    command: EditorContextMenuCommand,
    label: string,
    disabled: boolean = false,
  ): MenuItem {
    const hints: ShortcutHints = SHORTCUTS[command];
    const platform: string = this.studio.platform;
    const shortcut: string =
      platform === 'darwin'
        ? hints.mac
        : platform === 'linux'
          ? (hints.linux ?? hints.windows)
          : hints.windows;
    return disabled ? { id: command, label, shortcut, disabled } : { id: command, label, shortcut };
  }

  /**
   * Determines whether an editor is read-only, as Monaco has computed it — which, for a diff's
   * original side, the diff editor decides rather than the options it was given.
   * @param editor The editor.
   * @param monaco The editor's Monaco instance, or undefined when its window has none.
   * @returns Returns true when the editor rejects edits.
   */
  private isReadOnly(
    editor: MonacoApi.editor.ICodeEditor,
    monaco: typeof MonacoApi | undefined,
  ): boolean {
    if (monaco !== undefined) {
      return editor.getOption(monaco.editor.EditorOption.readOnly);
    }
    return editor.getRawOptions().readOnly === true;
  }

  /**
   * Determines whether Go to Definition can answer for a document: a language server serves it, or a
   * definition provider is registered for its language.
   * @param model The editor model.
   * @param monaco The editor's Monaco instance, or undefined when its window has none.
   * @returns Returns true when the row is offered.
   */
  private offersDefinitions(
    model: MonacoApi.editor.ITextModel,
    monaco: typeof MonacoApi | undefined,
  ): boolean {
    if (monaco !== undefined && hasDefinitionProvider(monaco, model.getLanguageId())) {
      return true;
    }
    return this.injector.get(LspFeatures).servesDocument(model);
  }

  /**
   * Goes to a place in a file: in the editor itself when it shows that file, otherwise by opening the
   * file in the workspace and revealing the place in its editor once that has registered.
   * @param editor The editor the menu was opened in.
   * @param path The absolute path of the file.
   * @param range The span of the definition.
   * @returns Returns a promise that resolves once the place is shown, or found not to be.
   */
  private async goTo(
    editor: MonacoApi.editor.ICodeEditor,
    path: string,
    range: MonacoApi.IRange,
  ): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const shown: string | null =
      model === null ? null : (this.editors.locate(model.uri.toString())?.path ?? null);
    if (shown === path) {
      revealTarget(editor, startOf(range));
      return;
    }
    // Only a workspace opens another file; a standalone tab has nowhere to put it.
    const opened: boolean = this.openFile === null ? false : await this.openFile(path);
    if (!opened) {
      this.log.debug('editorContextMenu', 'The definition is in a file that could not be opened');
      return;
    }
    for (let attempt: number = 0; attempt < REVEAL_POLL_ATTEMPTS; attempt++) {
      const modelUri: string | undefined = this.editors.modelUriForPath(path);
      const location: EditorLocation | undefined =
        modelUri === undefined ? undefined : this.editors.locate(modelUri);
      if (location !== undefined) {
        this.editors.requestReveal(location.documentId, range.startLineNumber, range.startColumn);
        return;
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, REVEAL_POLL_MS);
      });
    }
    this.log.debug('editorContextMenu', 'The opened file never showed an editor', path);
  }
}

/**
 * Resolves the Monaco instance an editor belongs to: the one loaded into its window, since each
 * window has its own.
 * @param editor The editor.
 * @returns Returns the instance, or undefined when its window has none.
 */
function instanceOf(editor: MonacoApi.editor.ICodeEditor): typeof MonacoApi | undefined {
  const view: Window | null = editor.getContainerDomNode().ownerDocument.defaultView;
  return view?.monaco ?? window.monaco;
}

/**
 * Determines whether one of Monaco's actions can run in an editor: Monaco's own precondition, which
 * for formatting asks whether a provider serves the language and the editor can be edited.
 * @param editor The editor.
 * @param command The command whose action to ask about.
 * @returns Returns true when it can.
 */
function supports(
  editor: MonacoApi.editor.ICodeEditor,
  command: EditorContextMenuCommand,
): boolean {
  const action: string | undefined = MONACO_ACTIONS[command];
  return action !== undefined && editor.getAction(action)?.isSupported() === true;
}

/**
 * Collapses a definition's span to its start, where the caret goes — as an editor's go to definition
 * places it, rather than selecting the name.
 * @param range The span.
 * @returns Returns the place to go to.
 */
function startOf(range: MonacoApi.IRange): { readonly line: number; readonly column: number } {
  return { line: range.startLineNumber, column: range.startColumn };
}
