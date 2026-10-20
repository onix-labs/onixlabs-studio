import type * as MonacoApi from 'monaco-editor';
import { FindRange, FindScope } from '@shared/angular/components/find-panel/find-request';
import { CodeDocument } from '@shared/angular/services/documents/documents';
import { OpenDiffEditor } from '@shared/angular/services/diffs/diffs';
import { EditorSearchTarget } from '@shared/angular/components/search-view/open-editors-find-adapter';

/**
 * What a find was asked from, snapshotted when it was asked (#1007): choosing a result moves the
 * caret and the active tab, and Current File and Current Selection must keep meaning what they meant.
 */
export interface EditorSearchOrigin {
  /**
   * Gets the absolute path of the file the find was asked from, or null when there was none.
   */
  readonly filePath: string | null;

  /**
   * Gets the selection when the find was asked for, or null when nothing was selected.
   */
  readonly selection: FindRange | null;

  /**
   * Gets whether the find was asked from a diff of the file rather than the file's own editor.
   */
  readonly fromDiff: boolean;
}

/**
 * What {@link EditorSearchTargets} reaches into to find the open editors.
 */
export interface EditorSearchTargetSources {
  /**
   * Lists the workspace's open text documents.
   */
  readonly documents: () => readonly CodeDocument[];

  /**
   * Lists the workspace's open diffs' editors.
   */
  readonly diffs: () => readonly OpenDiffEditor[];

  /**
   * Resolves the Monaco model URI of the editor showing a file, or undefined when none does.
   */
  readonly modelUriForPath: (path: string) => string | undefined;

  /**
   * Gets the main window's Monaco, or undefined before it has loaded.
   */
  readonly monaco: () => typeof MonacoApi | undefined;

  /**
   * Resolves the workspace root results are labelled relative to, or null when no folder is open.
   */
  readonly rootOf: () => string | null;

  /**
   * Brings a file's tab to the front.
   */
  readonly openFile: (path: string) => Promise<unknown>;

  /**
   * Brings a dock panel (a diff) to the front.
   */
  readonly activatePanel: (id: string) => void;
}

/**
 * Finds the open editors the Search panel's in-memory scopes search (#1007): every open text document
 * with a Monaco model for Open Files, or the one the find was asked from for Current File and Current
 * Selection — the selection pinned for the latter.
 *
 * A document is searched through the Monaco model its editor registered, so unsaved edits count. A
 * document with no model — a markdown document, a binary file, an editor in a popped-out window, whose
 * Monaco is that window's own — is passed over. An open diff is searched on its changed side, read-only,
 * when its file is not open as a document too: then the document is the file being edited, and the
 * diff a copy of it.
 */
export class EditorSearchTargets {
  /**
   * Initializes a new instance of the {@link EditorSearchTargets} class.
   * @param sources What the open editors are found through.
   */
  public constructor(private readonly sources: EditorSearchTargetSources) {}

  /**
   * Resolves the editors a scope searches.
   * @param scope The scope.
   * @param origin What the find was asked from.
   * @returns Returns the editors to search, empty for a disk scope or when nothing is open to search.
   */
  public resolve(scope: FindScope, origin: EditorSearchOrigin): readonly EditorSearchTarget[] {
    switch (scope) {
      case 'open-files':
        return this.openFiles();
      case 'file':
      case 'selection': {
        const target: EditorSearchTarget | null = this.originTarget(origin);
        if (target === null) {
          return [];
        }
        if (scope === 'file') {
          return [target];
        }
        return origin.selection === null ? [] : [{ ...target, range: origin.selection }];
      }
      default:
        return [];
    }
  }

  /**
   * Gets whether the find's origin can be searched in memory: its file is open in an editor here.
   * @param origin What the find was asked from.
   * @returns Returns true when Current File has an editor to search.
   */
  public hasOrigin(origin: EditorSearchOrigin): boolean {
    return this.originTarget(origin) !== null;
  }

  /**
   * Gets every open document with a model, then every open diff whose file is not one of them.
   * @returns Returns the targets.
   */
  private openFiles(): readonly EditorSearchTarget[] {
    const targets: EditorSearchTarget[] = [];
    const open: Set<string> = new Set<string>();
    for (const document of this.sources.documents()) {
      const path: string | null = document.filePath();
      if (path === null || open.has(path)) {
        continue;
      }
      const target: EditorSearchTarget | null = this.documentTarget(path);
      if (target !== null) {
        targets.push(target);
        open.add(path);
      }
    }
    for (const diff of this.sources.diffs()) {
      const path: string | null = diff.path();
      if (path !== null && !open.has(path)) {
        const target: EditorSearchTarget | null = this.diffTarget(diff, path);
        if (target !== null) {
          targets.push(target);
          open.add(path);
        }
      }
    }
    return targets;
  }

  /**
   * Gets the editor the find was asked from: the diff when it was asked from one, else the file's own
   * editor, else a diff of the file.
   * @param origin What the find was asked from.
   * @returns Returns the target, or null when the file is not open in an editor with a model.
   */
  private originTarget(origin: EditorSearchOrigin): EditorSearchTarget | null {
    const path: string | null = origin.filePath;
    if (path === null) {
      return null;
    }
    const diff: OpenDiffEditor | undefined = this.sources
      .diffs()
      .find((candidate: OpenDiffEditor): boolean => candidate.path() === path);
    const fromDiff: EditorSearchTarget | null =
      diff === undefined ? null : this.diffTarget(diff, path);
    if (origin.fromDiff && fromDiff !== null) {
      return fromDiff;
    }
    return this.documentTarget(path) ?? fromDiff;
  }

  /**
   * Builds the target for an open document's model.
   * @param path The document's absolute path.
   * @returns Returns the target, or null when no editor has registered a model for it.
   */
  private documentTarget(path: string): EditorSearchTarget | null {
    const monaco: typeof MonacoApi | undefined = this.sources.monaco();
    const uri: string | undefined = this.sources.modelUriForPath(path);
    if (monaco === undefined || uri === undefined) {
      return null;
    }
    const model: MonacoApi.editor.ITextModel | null = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (model === null || model.isDisposed()) {
      return null;
    }
    return {
      model,
      editor: (): MonacoApi.editor.ICodeEditor | null =>
        monaco.editor
          .getEditors()
          .find((editor: MonacoApi.editor.ICodeEditor): boolean => editor.getModel() === model) ??
        null,
      path,
      label: this.labelFor(path),
      activate: (): Promise<unknown> => this.sources.openFile(path),
    };
  }

  /**
   * Builds the read-only target for a diff's changed side.
   * @param diff The diff's editor.
   * @param path The compared file's absolute path.
   * @returns Returns the target, or null before the diff's editor has a model.
   */
  private diffTarget(diff: OpenDiffEditor, path: string): EditorSearchTarget | null {
    const model: MonacoApi.editor.ITextModel | null = diff.modifiedEditor()?.getModel() ?? null;
    if (model === null || model.isDisposed()) {
      return null;
    }
    return {
      model,
      editor: (): MonacoApi.editor.ICodeEditor | null => diff.modifiedEditor(),
      path,
      label: this.labelFor(path),
      readOnly: true,
      activate: (): void => this.sources.activatePanel(diff.id),
    };
  }

  /**
   * Labels a file relative to the workspace root, as the disk search's rows are labelled.
   * @param path The file's absolute path.
   * @returns Returns the label.
   */
  private labelFor(path: string): string {
    const root: string | null = this.sources.rootOf();
    if (root === null) {
      return path;
    }
    const prefix: string = root.replace(/[\\/]+$/, '');
    return path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`)
      ? path.slice(prefix.length + 1)
      : path;
  }
}
