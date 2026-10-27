import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type { MenuItem } from '@shared/angular/components/menu/menu';
import { pasteIntoEditor } from '@shared/angular/components/text-editor/editor-paste';
import { FindRouter } from '@shared/angular/services/find-router/find-router';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import { Log } from '@shared/angular/services/log/log';
import { hasComments } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import { QuickFixes } from '@shared/angular/services/quick-fix/quick-fixes';
import { RenameSymbol } from '@shared/angular/services/rename/rename-symbol';
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
  | 'typeDefinition'
  | 'implementation'
  | 'references'
  | 'symbol'
  | 'line'
  | 'rename'
  | 'quickFix'
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
  // No chord: neither Visual Studio nor VS Code gives Go to Type Definition one (#1142).
  typeDefinition: { mac: '', windows: '' },
  implementation: { mac: '⌘F12', windows: 'Ctrl+F12' },
  references: { mac: '⇧F12', windows: 'Shift+F12' },
  symbol: { mac: '⌘⇧O', windows: 'Ctrl+Shift+O' },
  line: { mac: '⌃G', windows: 'Ctrl+G' },
  rename: { mac: 'F2', windows: 'F2' },
  quickFix: { mac: '⌘.', windows: 'Ctrl+.' },
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

  /**
   * Runs a chosen row, or undefined for the right-click menu's own rows, which the
   * {@link EditorContextMenu} runs. Another menu opened through the same host — the quick-fix menu
   * (#1016) — runs its rows itself.
   */
  readonly run?: (id: string) => void;
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
 * offers definitions, Find All References where it offers references (#1014), Go to Symbol and Go to
 * Line, Find where a find panel answers, Quick Fix where the language offers code actions (#1016),
 * Rename Symbol where the language can rename (#1015), Format
 * and Toggle Comment where the language supports them and the editor can be edited, and the clipboard
 * — Copy and Select All alone in a read-only editor.
 *
 * Editors nobody attached — a markdown document's code fences — keep their own right-click.
 *
 * The same host opens other menus of Studio's at an editor's caret — the quick-fix menu (#1016) — so
 * they are drawn in the editor's window too: see {@link openAtCaret}.
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
   * Holds the navigation Go to Definition and Find All References go through (#1014).
   */
  private readonly navigation: EditorNavigation = inject(EditorNavigation);

  /**
   * Holds Rename Symbol, which the menu's row runs (#1015).
   */
  private readonly renameSymbol: RenameSymbol = inject(RenameSymbol);

  /**
   * Holds the quick fixes, which the menu's Quick Fix row opens (#1016).
   */
  private readonly quickFixes: QuickFixes = inject(QuickFixes);

  /**
   * Holds the opener each attached editor's menus open through.
   */
  private readonly openers: WeakMap<MonacoApi.editor.ICodeEditor, EditorContextMenuOpener> =
    new WeakMap<MonacoApi.editor.ICodeEditor, EditorContextMenuOpener>();

  /**
   * Holds the host platform, which decides the shortcut hints.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
    this.openers.set(editor, opener);
    return (): void => {
      subscription.dispose();
      if (this.openers.get(editor) === opener) {
        this.openers.delete(editor);
      }
    };
  }

  /**
   * Opens a menu of Studio's at an attached editor's caret, just below its line, through the host that
   * draws the right-click menu in the editor's window — the quick-fix menu (#1016), which ⌘., the fix
   * icon and the right-click menu's Quick Fix all open.
   * @param editor The editor.
   * @param items The menu's rows.
   * @param run Runs the chosen row.
   * @returns Returns true when the menu opened; false for an editor nobody attached, or with no caret.
   */
  public openAtCaret(
    editor: MonacoApi.editor.ICodeEditor,
    items: readonly MenuItem[],
    run: (id: string) => void,
  ): boolean {
    const opener: EditorContextMenuOpener | undefined = this.openers.get(editor);
    const position: MonacoApi.Position | null = editor.getPosition();
    if (opener === undefined || position === null) {
      return false;
    }
    editor.revealPosition(position);
    const visible: { top: number; left: number; height: number } | null =
      editor.getScrolledVisiblePosition(position);
    const box: DOMRect = editor.getContainerDomNode().getBoundingClientRect();
    const view: (Window & typeof globalThis) | null =
      editor.getContainerDomNode().ownerDocument.defaultView;
    // The menu is placed where a click would be: a click with the primary button, so the menu's first
    // row takes the keyboard, as it does when a menu opens from a key.
    const event: MouseEvent = new (view ?? window).MouseEvent('contextmenu', {
      clientX: box.left + (visible?.left ?? 0),
      clientY: box.top + (visible === null ? 0 : visible.top + visible.height),
      button: 0,
    });
    opener.open(event, { editor, items, run });
    return true;
  }

  /**
   * Opens the right-click menu at an attached editor's caret, just below its line — what ⇧F10
   * (Shift+F10) opens in place of Monaco's own menu (#1024) — with the rows a right-click there would
   * show.
   * @param editor The editor.
   * @returns Returns true when the menu opened; false for an editor nobody attached, or with no model or
   * caret.
   */
  public openAtCaretFromKeyboard(editor: MonacoApi.editor.ICodeEditor): boolean {
    if (editor.getModel() === null) {
      return false;
    }
    return this.openAtCaret(editor, this.itemsFor(editor), (id: string): void =>
      this.run(id, editor),
    );
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
    if (this.navigation.offersDefinitions(editor)) {
      navigation.push(this.item('definition', 'Go to Definition'));
    }
    // Offered only where the language server answers them (#1142).
    if (this.navigation.offersTypeDefinitions(editor)) {
      navigation.push(this.item('typeDefinition', 'Go to Type Definition'));
    }
    if (this.navigation.offersImplementations(editor)) {
      navigation.push(this.item('implementation', 'Go to Implementation'));
    }
    // Shown where the language can answer, but inert where no References panel would list the
    // answer — as Find is where no find panel answers.
    if (this.navigation.offersReferences(editor)) {
      navigation.push(
        this.item('references', 'Find All References', !this.navigation.listsReferences(editor)),
      );
    }
    navigation.push(this.item('symbol', 'Go to Symbol'), this.item('line', 'Go to Line'));

    const find: MenuItem[] = [this.item('find', 'Find', !this.findRouter.answers(editor))];

    // Hidden, not disabled, in a read-only editor: it can never be edited, so the rows are noise.
    const editing: MenuItem[] = [];
    if (writable && this.quickFixes.offersQuickFixes(editor)) {
      editing.push(this.item('quickFix', 'Quick Fix'));
    }
    if (writable && this.renameSymbol.offersRename(editor)) {
      editing.push(this.item('rename', 'Rename Symbol'));
    }
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
      case 'typeDefinition':
        void this.navigation.goToTypeDefinition(editor);
        return;
      case 'implementation':
        void this.navigation.goToImplementation(editor);
        return;
      case 'references':
        void this.navigation.findReferences(editor);
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
      case 'rename':
        void this.renameSymbol.rename(editor);
        return;
      case 'quickFix':
        void this.quickFixes.open(editor);
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
   * Goes to the definition of the symbol at the caret, never through Monaco's peek: straight there
   * when there is one — across files through the workspace — and the list of them in the References
   * panel when there are several (#1014), through the shared {@link EditorNavigation} F12 and
   * ⌘-click use too.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the definition is shown, or found not to be.
   */
  public goToDefinition(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    return this.navigation.goToDefinition(editor);
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
    // A command with no chord shows none, rather than an empty hint.
    const item: MenuItem =
      shortcut === '' ? { id: command, label } : { id: command, label, shortcut };
    return disabled ? { ...item, disabled } : item;
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
