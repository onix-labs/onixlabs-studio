import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { FindRequest, FindScope } from '@shared/angular/components/find-panel/find-request';
import { EditorSearchTarget } from '@shared/angular/components/search-view/open-editors-find-adapter';
import { SearchView } from '@shared/angular/components/search-view/search-view';
import { ScopedSearchAdapter } from '@features/workspace/angular/find/scoped-search-adapter';
import {
  EditorSearchOrigin,
  EditorSearchTargets,
} from '@features/workspace/angular/find/editor-search-targets';
import { OwningProject, SolutionModel } from '@features/workspace/angular/project/solution-model';
import {
  SearchPanelRequest,
  SearchPanelRequests,
} from '@features/workspace/angular/panels/search-panel/search-panel-requests';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { CodeDocument, Documents } from '@shared/angular/services/documents/documents';
import { Diffs, OpenDiffEditor } from '@shared/angular/services/diffs/diffs';
import { Monaco } from '@shared/angular/services/monaco/monaco';

/**
 * The scopes the workspace's dropdown offers, in the order it lists them (#1007).
 */
const WORKSPACE_SCOPES: readonly FindScope[] = [
  'workspace',
  'project',
  'open-files',
  'file',
  'selection',
];

/**
 * What a find is taken to be asked from before any request has said: nothing in particular, so
 * Current File follows the well's active document.
 */
const NO_ORIGIN: EditorSearchOrigin = { filePath: null, selection: null, fromDiff: false };

/**
 * The workspace's Find & Replace panel: the shared {@link SearchView} in the dock, searching the open
 * folder's files or its open editors.
 *
 * A scope dropdown (#1007) says where: the files on disk across the Whole Workspace or the active
 * file's Current Project, or the open editors — Open Files, Current File, Current Selection — unsaved
 * edits and all, where a replace is an editor edit the editor's undo takes back. An editor's ⌘F and
 * ⌘⌥F arrive through {@link SearchPanelRequests}; this panel snapshots what each was asked from, then
 * hands it to the view, which chooses the form and scope, seeds the query and searches at once.
 *
 * The view is the same one a code tab shows outside a workspace; this panel supplies what only a
 * workspace has — its files, its projects, its open documents and diffs, and the files with unsaved
 * edits that a replace on disk must leave alone.
 */
@Component({
  selector: 'app-search-panel',
  imports: [SearchView],
  templateUrl: './search-panel.html',
  styleUrl: './search-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPanel {
  /**
   * Gets the dock panel descriptor this body renders. Set by the dock outlet, which binds it on every
   * projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the scopes the dropdown offers, exposed for the template.
   */
  protected readonly scopes: readonly FindScope[] = WORKSPACE_SCOPES;

  /**
   * Holds the search client that runs a disk search in the main process.
   */
  private readonly search: Search = inject(Search);

  /**
   * Holds the file opener used to open a match's file.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry used to reveal an opened match's line.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the active-workspace seam supplying the root to search.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds this view's documents, which say which files are open with unsaved edits.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds this view's project model, which says which project the active file belongs to.
   */
  private readonly solution: SolutionModel = inject(SolutionModel);

  /**
   * Holds this view's open diffs, whose changed sides the in-memory scopes search read-only.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds the Monaco loader, whose main-window instance holds the open editors' models.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds this view's dock layout, through which a diff's tab is brought forward.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the channel this view's find requests arrive through (#1007).
   */
  private readonly requests: SearchPanelRequests = inject(SearchPanelRequests);

  /**
   * Holds what the last find request was asked from — its file and selection, snapshotted — or
   * nothing before any request.
   */
  private readonly origin: WritableSignal<EditorSearchOrigin> =
    signal<EditorSearchOrigin>(NO_ORIGIN);

  /**
   * Holds the latest request handed to the view — a fresh object per request — or null before any.
   */
  protected readonly request: WritableSignal<FindRequest | null> = signal<FindRequest | null>(null);

  /**
   * Gets the absolute path of the well's active document, or null when none is active or it is
   * unsaved.
   */
  private readonly activeDocumentPath: Signal<string | null> = computed((): string | null => {
    const id: string | null = this.documents.activeDocumentId();
    return id === null ? null : (this.documents.get(id)?.filePath() ?? null);
  });

  /**
   * Gets the file Current File searches: the one the last request came from, else the well's active
   * document.
   */
  private readonly currentFile: Signal<string | null> = computed(
    (): string | null => this.origin().filePath ?? this.activeDocumentPath(),
  );

  /**
   * Gets the folder Current Project searches — the current file's project's — or null when the file
   * belongs to no project, or there is no project system.
   */
  private readonly projectDirectory: Signal<string | null> = computed((): string | null => {
    const file: string | null = this.currentFile();
    const owner: OwningProject | null = file === null ? null : this.solution.owningProject(file);
    return owner?.directory ?? null;
  });

  /**
   * Gets the scopes with nothing to search: Current Project without a project for the current file,
   * Current File without a file, Current Selection without a selection.
   */
  protected readonly disabledScopes: Signal<ReadonlySet<FindScope>> = computed(
    (): ReadonlySet<FindScope> =>
      new Set<FindScope>([
        ...(this.projectDirectory() === null ? (['project'] as const) : []),
        ...(this.currentFile() === null ? (['file'] as const) : []),
        ...(this.origin().selection === null ? (['selection'] as const) : []),
      ]),
  );

  /**
   * Holds the resolver of the open editors the in-memory scopes search.
   */
  private readonly editorTargets: EditorSearchTargets = new EditorSearchTargets({
    documents: (): readonly CodeDocument[] => this.documents.list(),
    diffs: (): readonly OpenDiffEditor[] => this.diffs.openEditors(),
    modelUriForPath: (path: string): string | undefined => this.editors.modelUriForPath(path),
    monaco: (): typeof MonacoApi | undefined => this.monaco.getMonaco(),
    rootOf: (): string | null => this.activeWorkspace.rootPath(),
    openFile: (path: string): Promise<boolean> => this.fileOpener.openPath(path),
    activatePanel: (id: string): void => this.activatePanel(id),
  });

  /**
   * Holds the adapter the view drives, searching whichever scope is chosen.
   */
  protected readonly adapter: ScopedSearchAdapter = new ScopedSearchAdapter({
    search: this.search,
    fileOpener: this.fileOpener,
    editors: this.editors,
    rootOf: (): string | null => this.activeWorkspace.rootPath(),
    projectDirectoryOf: (): string | null => untracked(this.projectDirectory),
    editorTargetsOf: (scope: FindScope): readonly EditorSearchTarget[] =>
      this.editorTargets.resolve(scope, {
        ...untracked(this.origin),
        filePath: untracked(this.currentFile),
      }),
  });

  /**
   * Resolves the paths of this view's files open with unsaved edits, which a replace on disk leaves
   * alone; exposed for the template.
   */
  protected readonly unsavedPaths: () => ReadonlySet<string> = (): ReadonlySet<string> => {
    const paths: Set<string> = new Set<string>();
    for (const document of this.documents.list()) {
      const path: string | null = document.filePath();
      if (path !== null && document.dirty()) {
        paths.add(path);
      }
    }
    return paths;
  };

  /**
   * Initializes a new instance of the {@link SearchPanel} class, answering each find request as it
   * arrives — or, for a panel the request's reveal created, the one waiting for it — taking it so it
   * is answered once.
   */
  public constructor() {
    effect((): void => {
      if (this.requests.pending() === null) {
        return;
      }
      untracked((): void => {
        const pending: SearchPanelRequest | null = this.requests.take();
        if (pending !== null) {
          this.answer(pending);
        }
      });
    });
  }

  /**
   * Answers a find request (#1007): snapshots what it was asked from — so Current File and Current
   * Selection keep meaning what they meant as results move the caret — then hands it to the view.
   * @param pending The request.
   */
  private answer(pending: SearchPanelRequest): void {
    const { request } = pending;
    this.origin.set({
      filePath: request.filePath ?? this.activeDocumentPath(),
      selection: request.selection ?? null,
      fromDiff: pending.fromDiff,
    });
    this.request.set({ ...request });
  }

  /**
   * Brings a dock panel — a diff a match is in — to the front of its stack.
   * @param id The panel's id.
   */
  private activatePanel(id: string): void {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), id);
    if (stack !== null) {
      this.dockState.setActive(stack.id, id);
    }
  }
}
