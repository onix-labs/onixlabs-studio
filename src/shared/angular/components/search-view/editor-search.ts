import { computed, signal, Signal, untracked, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type {
  FindRange,
  FindRequest,
  FindScope,
} from '@shared/angular/components/find-panel/find-request';
import { EditorSearchTarget, OpenEditorsFindAdapter } from './open-editors-find-adapter';

/**
 * What an {@link EditorSearch} reaches into: the tab's main editor and what to call an editor's text.
 */
export interface EditorSearchSources {
  /**
   * Resolves the tab's main editor — searched by a find that names none (a ribbon or strip Find) — or
   * null when the tab has none, or before it is ready.
   */
  readonly mainEditor: () => MonacoApi.editor.ICodeEditor | null;

  /**
   * Names an editor's text in the results — its file's name, or what it holds ("Request Body").
   */
  readonly labelOf: (editor: MonacoApi.editor.ICodeEditor) => string;
}

/**
 * The scopes a tab outside a workspace offers: there is only the editor to search.
 */
const EDITOR_SCOPES: readonly FindScope[] = ['file', 'selection'];

/**
 * Says that Current Selection has nothing to search.
 */
const NO_SELECTION: ReadonlySet<FindScope> = new Set<FindScope>(['selection']);

/**
 * Says that every offered scope has something to search.
 */
const NOTHING_DISABLED: ReadonlySet<FindScope> = new Set<FindScope>();

/**
 * Holds the state of a tab's own Find & Replace outside a workspace (#1007): a standalone code tab
 * (its code or its generated code), a binary tab's disassembly, or an API Explorer request's bodies.
 * The tab keeps one, opens it from its {@link import('@shared/angular/services/find-router/find-host').FindHost},
 * and shows it as the shared search view — the same view the workspace's Search panel is — through
 * {@link import('./editor-search-panel').EditorSearchPanel}.
 *
 * It searches the one editor the latest find came from, its unsaved text and all: Current File is the
 * whole of it, and Current Selection the selection snapshotted when the find was asked for. A read-only
 * editor is searched without Replace.
 */
export class EditorSearch {
  /**
   * Gets the scopes the view offers.
   */
  public readonly scopes: readonly FindScope[] = EDITOR_SCOPES;

  /**
   * Holds whether the view is shown.
   */
  private readonly visibleState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the latest request, or null before the first.
   */
  private readonly requestState: WritableSignal<FindRequest | null> = signal<FindRequest | null>(
    null,
  );

  /**
   * Holds the editor the latest request came from, or null before the first.
   */
  private readonly editorState: WritableSignal<MonacoApi.editor.ICodeEditor | null> =
    signal<MonacoApi.editor.ICodeEditor | null>(null);

  /**
   * Holds whether that editor is read-only.
   */
  private readonly readOnlyState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the view is shown.
   */
  public readonly visible: Signal<boolean> = this.visibleState.asReadonly();

  /**
   * Gets the latest request the view answers, or null before the first.
   */
  public readonly request: Signal<FindRequest | null> = this.requestState.asReadonly();

  /**
   * Gets whether the editor searched can be replaced in: false for a read-only one.
   */
  public readonly replaceable: Signal<boolean> = computed((): boolean => !this.readOnlyState());

  /**
   * Gets the scopes with nothing to search: Current Selection when the find was asked for with
   * nothing selected.
   */
  public readonly disabledScopes: Signal<ReadonlySet<FindScope>> = computed(
    (): ReadonlySet<FindScope> =>
      (this.requestState()?.selection ?? null) === null ? NO_SELECTION : NOTHING_DISABLED,
  );

  /**
   * Gets the adapter the view drives, over the editor the latest request came from.
   */
  public readonly adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(
    (scope: FindScope): readonly EditorSearchTarget[] => this.targetsFor(scope),
  );

  /**
   * Initializes a new instance of the {@link EditorSearch} class.
   * @param sources The tab's main editor, and what to call an editor's text.
   */
  public constructor(private readonly sources: EditorSearchSources) {}

  /**
   * Opens the view as a request asks, over the editor it came from. Each call is a fresh request, so
   * the view re-seeds and refocuses even when it is already open.
   * @param request The find to open.
   * @param editor The editor to search, or null for the main editor.
   */
  public open(request: FindRequest, editor: MonacoApi.editor.ICodeEditor | null): void {
    const target: MonacoApi.editor.ICodeEditor | null = editor ?? this.sources.mainEditor();
    if (target === null) {
      return;
    }
    // What was found in another editor says nothing about this one, and its highlights must go.
    if (untracked(this.editorState) !== target) {
      this.adapter.clear();
      this.editorState.set(target);
    }
    // Read on each find: a request body is read-only while it sends.
    this.readOnlyState.set(target.getRawOptions().readOnly === true);
    this.requestState.set({ ...request });
    this.visibleState.set(true);
  }

  /**
   * Hides the view; going, it clears its results and highlights.
   */
  public close(): void {
    this.visibleState.set(false);
  }

  /**
   * Resolves the editor a scope searches: the whole of it for Current File, its snapshotted selection
   * for Current Selection, nothing when it has no model or the find had no selection.
   * @param scope The scope.
   * @returns Returns the target, or none.
   */
  private targetsFor(scope: FindScope): readonly EditorSearchTarget[] {
    const editor: MonacoApi.editor.ICodeEditor | null = untracked(this.editorState);
    const model: MonacoApi.editor.ITextModel | null = editor?.getModel() ?? null;
    if (editor === null || model === null || model.isDisposed()) {
      return [];
    }
    const request: FindRequest | null = untracked(this.requestState);
    const range: FindRange | null = scope === 'selection' ? (request?.selection ?? null) : null;
    if (scope === 'selection' && range === null) {
      return [];
    }
    const label: string = this.sources.labelOf(editor);
    return [
      {
        model,
        editor: (): MonacoApi.editor.ICodeEditor => editor,
        path: request?.filePath ?? label,
        label,
        range,
        readOnly: untracked(this.readOnlyState),
      },
    ];
  }
}
