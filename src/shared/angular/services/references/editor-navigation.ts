import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { EditorLocation, Editors } from '@shared/angular/services/editors/editors';
import { revealTarget } from '@shared/angular/services/go-to/go-to-model';
import {
  HierarchyKind,
  HierarchyRouter,
  HierarchySource,
} from '@shared/angular/services/hierarchy/hierarchy';
import { Log } from '@shared/angular/services/log/log';
import { LspDefinition, LspFeatures } from '@shared/angular/services/lsp/lsp-features';
import {
  hasDefinitionProvider,
  hasReferenceProvider,
  providedDefinitions,
  providedReferences,
} from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { LinePreviews } from './line-previews';
import { CodeLocation, ReferenceItem, ReferenceList, ReferenceListKind } from './reference-list';
import { ReferencesRouter } from './references-router';

/**
 * Holds how long to wait between looks for an opened file's editor, in milliseconds.
 */
const REVEAL_POLL_MS: number = 80;

/**
 * Holds how many times to look for an opened file's editor before giving up (two seconds in all).
 */
const REVEAL_POLL_ATTEMPTS: number = 25;

/**
 * Takes an editor to the definition of a symbol, or lists every reference to it, the way Studio does
 * it rather than Monaco (#1012, #1014): never through Monaco's peek, and across files through the
 * workspace. F12, ⇧F12 and ⌘-click (Ctrl-click) reach it through Studio's Monaco commands, and the
 * right-click menu's Go to Definition and Find All References through the menu.
 *
 * A language server's answer comes first, by path, so a definition or reference in a file not yet open
 * is found and opened; otherwise the providers Monaco's own languages register answer, within the
 * documents Monaco holds. One definition is gone to straight away; several are listed in the
 * References panel to choose from, as every reference is — through the {@link ReferencesRouter}.
 */
@Service()
export class EditorNavigation {
  /**
   * Holds the editor registry, which knows the file each document editor shows.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the router that shows a references list where it is answered.
   */
  private readonly router: ReferencesRouter = inject(ReferencesRouter);

  /**
   * Holds the router that shows a hierarchy in the workspace's Hierarchy panel (#1153).
   */
  private readonly hierarchies: HierarchyRouter = inject(HierarchyRouter);

  /**
   * Holds the reader of each listed place's line.
   */
  private readonly linePreviews: LinePreviews = inject(LinePreviews);

  /**
   * Holds the injector the language-server features are resolved from as they are needed. Resolved
   * then rather than injected here: they reach into Monaco, whose commands reach back here.
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
   * Holds the number of the latest references search, so an answer that arrives after a newer search
   * began is dropped rather than replacing it.
   */
  private searches: number = 0;

  /**
   * Sets how a place in another file is opened, called once by the workspace feature at start-up. A
   * seam rather than an injection: the workspace's file opener reaches the diff panels, whose diff
   * editor reaches here, so importing it would be a cycle.
   * @param openFile Opens a file by absolute path, resolving whether it opened.
   */
  public useFileOpener(openFile: (path: string) => Promise<boolean>): void {
    this.openFile = openFile;
  }

  /**
   * Determines whether Go to Definition can answer for a document: a definition provider is
   * registered for its language, or a language server serves it.
   * @param editor The editor.
   * @returns Returns true when it can.
   */
  public offersDefinitions(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null) {
      return false;
    }
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (monaco !== undefined && hasDefinitionProvider(monaco, model.getLanguageId())) {
      return true;
    }
    return this.injector.get(LspFeatures).servesDocument(model);
  }

  /**
   * Determines whether Find All References can answer for a document: a reference provider is
   * registered for its language, or a language server serves it.
   * @param editor The editor.
   * @returns Returns true when it can.
   */
  public offersReferences(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    if (model === null) {
      return false;
    }
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (monaco !== undefined && hasReferenceProvider(monaco, model.getLanguageId())) {
      return true;
    }
    return this.injector.get(LspFeatures).servesDocument(model);
  }

  /**
   * Determines whether a references list from an editor would be shown anywhere.
   * @param editor The editor.
   * @returns Returns true when a References panel answers it.
   */
  public listsReferences(editor: MonacoApi.editor.ICodeEditor): boolean {
    return this.router.answers(editor);
  }

  /**
   * Goes to the definition of the symbol at the caret: straight there when there is one, the list of
   * them in the References panel when there are several — or the first, where no panel answers.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the definition is shown, or found not to be.
   */
  public goToDefinition(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    return this.goToFound(
      editor,
      'definitions',
      (model: MonacoApi.editor.ITextModel, position: MonacoApi.Position) =>
        this.definitionsAt(editor, model, position),
    );
  }

  /**
   * Determines whether Go to Implementation can answer for a document: the language server serving it
   * answers `textDocument/implementation` (#1142).
   * @param editor The editor.
   * @returns Returns true when it can.
   */
  public offersImplementations(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    return (
      model !== null && this.injector.get(LspFeatures).servesNavigation(model, 'implementation')
    );
  }

  /**
   * Determines whether Go to Type Definition can answer for a document: the language server serving
   * it answers `textDocument/typeDefinition` (#1142).
   * @param editor The editor.
   * @returns Returns true when it can.
   */
  public offersTypeDefinitions(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    return (
      model !== null && this.injector.get(LspFeatures).servesNavigation(model, 'typeDefinition')
    );
  }

  /**
   * Determines whether Show Call Hierarchy or Show Type Hierarchy can answer for a document (#1153):
   * the language server serving it gives that hierarchy, and a workspace is in front to show it in.
   * @param editor The editor.
   * @param kind Which hierarchy.
   * @returns Returns true when it can.
   */
  public offersHierarchy(editor: MonacoApi.editor.ICodeEditor, kind: HierarchyKind): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    return (
      model !== null &&
      this.hierarchies.available() &&
      this.injector
        .get(LspFeatures)
        .servesNavigation(model, kind === 'calls' ? 'callHierarchy' : 'typeHierarchy')
    );
  }

  /**
   * Shows the call or type hierarchy of the symbol at the caret in the workspace's Hierarchy panel
   * (#1153): a member's callers (and, a click away, its callees), or a type's base types (and its
   * derived types), each expanded a level at a time.
   * @param editor The editor.
   * @param kind Which hierarchy.
   * @returns Returns a promise that resolves once the hierarchy is shown, or found not to be.
   */
  public async showHierarchy(
    editor: MonacoApi.editor.ICodeEditor,
    kind: HierarchyKind,
  ): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const position: MonacoApi.Position | null = editor.getPosition();
    if (model === null || position === null || !this.hierarchies.available()) {
      return;
    }
    const source: HierarchySource | null = await this.injector
      .get(LspFeatures)
      .hierarchy(model, position, kind);
    if (source === null) {
      this.log.debug('navigation', `No ${kind} hierarchy answers this document`);
      return;
    }
    this.hierarchies.show(source);
  }

  /**
   * Shows the call or type hierarchy of the symbol at the caret in the active document's editor — the
   * ribbon's and the Edit menu's way to what ⌃⌥H and ⌃⇧H do in an editor (#1153), which focus has
   * left by the time a ribbon button is pressed.
   * @param kind Which hierarchy.
   * @returns Returns a promise that resolves once the hierarchy is shown, or found not to be.
   */
  public showHierarchyInActiveEditor(kind: HierarchyKind): Promise<void> {
    const editor: MonacoApi.editor.ICodeEditor | null = this.activeEditor();
    if (editor === null) {
      this.log.debug('navigation', 'No code editor is active to show a hierarchy from');
      return Promise.resolve();
    }
    return this.showHierarchy(editor, kind);
  }

  /**
   * Finds the editor showing the active workspace's active document: the one the user was last
   * editing, in front in its group.
   * @returns Returns the editor, or null when the active document is not a code document.
   */
  private activeEditor(): MonacoApi.editor.ICodeEditor | null {
    const documentId: string | null = this.hierarchies.activeDocumentId();
    if (documentId === null) {
      return null;
    }
    return (
      window.monaco?.editor
        .getEditors()
        .find((candidate: MonacoApi.editor.ICodeEditor): boolean => {
          const uri: string | undefined = candidate.getModel()?.uri.toString();
          return uri !== undefined && this.editors.locate(uri)?.documentId === documentId;
        }) ?? null
    );
  }

  /**
   * Goes to the code that implements the symbol at the caret (#1142) — for an interface or abstract
   * member, the classes that implement it: straight there when there is one, listed in the References
   * panel when there are several.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the implementation is shown, or found not to be.
   */
  public goToImplementation(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    return this.goToFound(
      editor,
      'implementations',
      async (model: MonacoApi.editor.ITextModel, position: MonacoApi.Position) =>
        (await this.injector.get(LspFeatures).implementations(model, position)) ?? [],
    );
  }

  /**
   * Goes to the declaration of the type of the symbol at the caret (#1142) — from a variable,
   * parameter or property to its type: straight there when there is one, listed when there are several.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the type is shown, or found not to be.
   */
  public goToTypeDefinition(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    return this.goToFound(
      editor,
      'definitions',
      async (model: MonacoApi.editor.ITextModel, position: MonacoApi.Position) =>
        (await this.injector.get(LspFeatures).typeDefinitions(model, position)) ?? [],
    );
  }

  /**
   * Finds places for the symbol at the caret and goes to them: straight there when there is one (or no
   * References panel answers the editor), listed in the References panel when there are several.
   * @param editor The editor.
   * @param kind What the list lists, when there are several.
   * @param find Finds the places.
   * @returns Returns a promise that resolves once a place is shown, or none was found.
   */
  private async goToFound(
    editor: MonacoApi.editor.ICodeEditor,
    kind: ReferenceListKind,
    find: (
      model: MonacoApi.editor.ITextModel,
      position: MonacoApi.Position,
    ) => Promise<readonly CodeLocation[]>,
  ): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const position: MonacoApi.Position | null = editor.getPosition();
    if (model === null || position === null) {
      return;
    }
    const found: readonly CodeLocation[] = await find(model, position);
    const first: CodeLocation | undefined = found[0];
    if (first === undefined) {
      this.log.debug('navigation', `No ${kind} found`, model.getLanguageId());
      return;
    }
    if (found.length === 1 || !this.router.answers(editor)) {
      await this.goTo(editor, first);
      return;
    }
    const items: readonly ReferenceItem[] = await this.linePreviews.fill(found, instanceOf(editor));
    this.router.show({ kind, symbol: symbolAt(model, position), status: 'done', items }, editor);
  }

  /**
   * Lists every reference to the symbol at the caret, its declaration included, in the References
   * panel — revealed at once as searching, then filled as the answer arrives. A new search replaces
   * the last, and an answer that arrives after a newer search began is dropped.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the list is shown, or nothing answered.
   */
  public async findReferences(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const position: MonacoApi.Position | null = editor.getPosition();
    if (model === null || position === null) {
      return;
    }
    if (!this.router.answers(editor)) {
      this.log.debug('navigation', 'No References panel answers this editor');
      return;
    }
    const search: number = ++this.searches;
    const symbol: string = symbolAt(model, position);
    this.router.show({ kind: 'references', symbol, status: 'searching', items: [] }, editor);
    const list: ReferenceList = await this.referencesAt(editor, model, position, symbol);
    if (search !== this.searches) {
      this.log.debug('navigation', 'A newer references search replaced this one');
      return;
    }
    this.log.debug('navigation', 'References found', list.status, list.items.length);
    this.router.show(list, editor);
  }

  /**
   * Goes to a place: in the editor itself when it shows that document, otherwise by opening the file
   * in the workspace and revealing the place in its editor once that has registered. The place is
   * centred and the editor focused, with the caret at its start — or, for a listed place on one line,
   * its span selected, as a search result is.
   * @param editor The editor the request came from, or null for one from a panel.
   * @param location The place.
   * @param select Whether to select the place's span rather than place the caret at its start.
   * @returns Returns a promise that resolves once the place is shown, or found not to be.
   */
  public async goTo(
    editor: MonacoApi.editor.ICodeEditor | null,
    location: CodeLocation,
    select: boolean = false,
  ): Promise<void> {
    const { path, range } = location;
    const endColumn: number | undefined =
      select && range.startLineNumber === range.endLineNumber ? range.endColumn : undefined;
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor !== null && model !== null && this.shows(model, path)) {
      revealTarget(editor, {
        line: range.startLineNumber,
        column: range.startColumn,
        ...(endColumn === undefined ? {} : { endLine: range.startLineNumber, endColumn }),
      });
      return;
    }
    // A document with no file is named by its model URI, and is already open wherever it is shown.
    let located: EditorLocation | undefined = this.editors.locate(path);
    if (located === undefined) {
      // Only a workspace opens another file; a standalone tab has nowhere to put it.
      const opened: boolean = this.openFile !== null && (await this.openFile(path));
      if (!opened) {
        this.log.debug('navigation', 'The place is in a file that could not be opened', path);
        return;
      }
      located = await this.editorFor(path);
    }
    if (located === undefined) {
      this.log.debug('navigation', 'The opened file never showed an editor', path);
      return;
    }
    if (endColumn === undefined) {
      this.editors.requestReveal(located.documentId, range.startLineNumber, range.startColumn);
    } else {
      this.editors.requestReveal(
        located.documentId,
        range.startLineNumber,
        range.startColumn,
        endColumn,
      );
    }
  }

  /**
   * Finds the definitions of the symbol at a position: the language server's, by path, when one
   * serves the document; otherwise the definition providers', mapped to the files they are in.
   * @param editor The editor.
   * @param model The editor's model.
   * @param position The one-based position.
   * @returns Returns the definitions, or empty when none was found.
   */
  private async definitionsAt(
    editor: MonacoApi.editor.ICodeEditor,
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
  ): Promise<readonly CodeLocation[]> {
    const served: readonly LspDefinition[] | null = await this.injector
      .get(LspFeatures)
      .definitions(model, position);
    if (served !== null) {
      return served;
    }
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    const provided: readonly MonacoApi.languages.Location[] =
      monaco === undefined ? [] : await providedDefinitions(monaco, model, position);
    return provided.map((location: MonacoApi.languages.Location): CodeLocation =>
      this.toCodeLocation(location),
    );
  }

  /**
   * Finds every reference to the symbol at a position, as a finished list: the language server's,
   * with paths, when one serves the document; otherwise the reference providers'; unavailable when
   * neither serves it.
   * @param editor The editor.
   * @param model The editor's model.
   * @param position The one-based position.
   * @param symbol The symbol searched for.
   * @returns Returns the list.
   */
  private async referencesAt(
    editor: MonacoApi.editor.ICodeEditor,
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
    symbol: string,
  ): Promise<ReferenceList> {
    const served: readonly ReferenceItem[] | null = await this.injector
      .get(LspFeatures)
      .references(model, position);
    if (served !== null) {
      return { kind: 'references', symbol, status: 'done', items: served };
    }
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (monaco === undefined || !hasReferenceProvider(monaco, model.getLanguageId())) {
      return { kind: 'references', symbol, status: 'unavailable', items: [] };
    }
    const provided: readonly MonacoApi.languages.Location[] = await providedReferences(
      monaco,
      model,
      position,
    );
    const items: readonly ReferenceItem[] = await this.linePreviews.fill(
      provided.map((location: MonacoApi.languages.Location): CodeLocation =>
        this.toCodeLocation(location),
      ),
      monaco,
    );
    return { kind: 'references', symbol, status: 'done', items };
  }

  /**
   * Maps a provider's location to a place: the file its model shows, or the model's URI for a
   * document with no file.
   * @param location The provider's location.
   * @returns Returns the place.
   */
  private toCodeLocation(location: MonacoApi.languages.Location): CodeLocation {
    const uri: string = location.uri.toString();
    return { path: this.editors.locate(uri)?.path ?? uri, range: location.range };
  }

  /**
   * Determines whether a model is the document a place is in: by the file it shows, or by its URI
   * for a document with no file.
   * @param model The model.
   * @param path The place's path.
   * @returns Returns true when it is.
   */
  private shows(model: MonacoApi.editor.ITextModel, path: string): boolean {
    const uri: string = model.uri.toString();
    return uri === path || this.editors.locate(uri)?.path === path;
  }

  /**
   * Waits for the editor of a file just opened to register, looking every {@link REVEAL_POLL_MS}.
   * @param path The file's absolute path.
   * @returns Returns the editor's location, or undefined when none registered in time.
   */
  private async editorFor(path: string): Promise<EditorLocation | undefined> {
    for (let attempt: number = 0; attempt < REVEAL_POLL_ATTEMPTS; attempt++) {
      const modelUri: string | undefined = this.editors.modelUriForPath(path);
      const located: EditorLocation | undefined =
        modelUri === undefined ? undefined : this.editors.locate(modelUri);
      if (located !== undefined) {
        return located;
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, REVEAL_POLL_MS);
      });
    }
    return undefined;
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
 * Reads the symbol at a position: the word there, or an empty string when there is none.
 * @param model The model.
 * @param position The one-based position.
 * @returns Returns the symbol.
 */
function symbolAt(model: MonacoApi.editor.ITextModel, position: MonacoApi.IPosition): string {
  return model.getWordAtPosition(position)?.word ?? '';
}
