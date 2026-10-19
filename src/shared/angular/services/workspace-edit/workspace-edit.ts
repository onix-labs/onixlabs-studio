import type * as MonacoApi from 'monaco-editor';

/**
 * One text edit to a document: the span it replaces, one-based as the editor counts, and the text
 * that replaces it.
 */
export interface TextEditEntry {
  /**
   * Gets the span replaced.
   */
  readonly range: MonacoApi.IRange;

  /**
   * Gets the text that replaces it.
   */
  readonly text: string;
}

/**
 * One document's edits in a {@link WorkspaceTextEdits}.
 */
export interface FileTextEdits {
  /**
   * Gets the document: the absolute path of its file, or — for a document with no file — the URI of
   * the model it is open as.
   */
  readonly path: string;

  /**
   * Gets the edits, in any order; none may overlap another.
   */
  readonly edits: readonly TextEditEntry[];
}

/**
 * Names a part of an edit that was not applied, and why — for the user.
 */
export interface SkippedEdit {
  /**
   * Gets the document, by path (or model URI).
   */
  readonly path: string;

  /**
   * Gets why it was not applied.
   */
  readonly reason: string;
}

/**
 * Edits across a workspace, by document (#1015): a rename's answer, or a language server's own edit.
 */
export interface WorkspaceTextEdits {
  /**
   * Gets the documents and their edits.
   */
  readonly files: readonly FileTextEdits[];

  /**
   * Gets the parts that cannot be applied at all — creating, renaming or deleting a file — named so
   * the user is told.
   */
  readonly refused: readonly SkippedEdit[];
}

/**
 * Names where a document's edits were applied: in its open editor (unsaved, undoable), or to its file
 * on disk.
 */
export type AppliedWhere = 'editor' | 'disk';

/**
 * Names one document a {@link WorkspaceTextEdits} changed.
 */
export interface AppliedFile {
  /**
   * Gets the document, by path (or model URI).
   */
  readonly path: string;

  /**
   * Gets how many edits it took.
   */
  readonly edits: number;

  /**
   * Gets where they were applied.
   */
  readonly where: AppliedWhere;
}

/**
 * Reports what applying a {@link WorkspaceTextEdits} did.
 */
export interface WorkspaceEditOutcome {
  /**
   * Gets the documents changed.
   */
  readonly applied: readonly AppliedFile[];

  /**
   * Gets the parts not applied, each with its reason.
   */
  readonly skipped: readonly SkippedEdit[];
}

/**
 * Holds the reason a file operation in an edit is refused: Studio advertises no resource operations
 * to servers yet, so one arriving anyway is named rather than half-applied.
 */
export const FILE_OPERATION_REFUSED: string =
  "Creating, renaming or deleting files isn't supported yet.";

/**
 * A zero-based Language Server Protocol position.
 */
interface LspPosition {
  readonly line: number;
  readonly character: number;
}

/**
 * A Language Server Protocol range.
 */
interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

/**
 * Reads an LSP `WorkspaceEdit` into edits by document (#1015): its versioned `documentChanges` when it
 * has them — each a `TextDocumentEdit`, or a file operation, which is refused and named — and its
 * per-file `changes` otherwise, as the protocol has a client prefer. Versions are not checked: a
 * closed file has none, and an open one is edited as it stands. Malformed entries are dropped.
 * @param edit The edit, untrusted.
 * @param toPath Maps a document's `file:` URI to the absolute path the edits are keyed by.
 * @returns Returns the edits by document, in the server's order, and the parts refused.
 */
export function fromLspWorkspaceEdit(
  edit: unknown,
  toPath: (uri: string) => string,
): WorkspaceTextEdits {
  const files: Map<string, TextEditEntry[]> = new Map<string, TextEditEntry[]>();
  const refused: SkippedEdit[] = [];
  const add: (uri: string, edits: unknown) => void = (uri: string, edits: unknown): void => {
    if (!Array.isArray(edits)) {
      return;
    }
    const path: string = toPath(uri);
    const entries: TextEditEntry[] = files.get(path) ?? [];
    for (const raw of edits as unknown[]) {
      const entry: TextEditEntry | null = toTextEdit(raw);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    files.set(path, entries);
  };
  const candidate: { changes?: unknown; documentChanges?: unknown } =
    typeof edit === 'object' && edit !== null ? edit : {};
  if (Array.isArray(candidate.documentChanges)) {
    for (const change of candidate.documentChanges as unknown[]) {
      if (typeof change !== 'object' || change === null) {
        continue;
      }
      const entry: {
        kind?: unknown;
        uri?: unknown;
        oldUri?: unknown;
        textDocument?: unknown;
        edits?: unknown;
      } = change;
      if (typeof entry.kind === 'string') {
        const uri: unknown = entry.kind === 'rename' ? entry.oldUri : entry.uri;
        refused.push({
          path: typeof uri === 'string' ? toPath(uri) : '',
          reason: FILE_OPERATION_REFUSED,
        });
        continue;
      }
      const uri: unknown = (entry.textDocument as { uri?: unknown } | undefined)?.uri;
      if (typeof uri === 'string') {
        add(uri, entry.edits);
      }
    }
  } else if (typeof candidate.changes === 'object' && candidate.changes !== null) {
    for (const [uri, edits] of Object.entries(candidate.changes as Record<string, unknown>)) {
      add(uri, edits);
    }
  }
  return {
    files: [...files]
      .filter(([, edits]: [string, TextEditEntry[]]): boolean => edits.length > 0)
      .map(([path, edits]: [string, TextEditEntry[]]): FileTextEdits => ({ path, edits })),
    refused,
  };
}

/**
 * Reads one LSP text edit — plain, annotated, or a snippet edit, whose snippet text is taken as it is
 * written — into a one-based edit.
 * @param raw The edit, untrusted.
 * @returns Returns the edit, or null when it is malformed.
 */
function toTextEdit(raw: unknown): TextEditEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate: { range?: unknown; newText?: unknown; snippet?: unknown } = raw;
  const text: unknown =
    candidate.newText ?? (candidate.snippet as { value?: unknown } | undefined)?.value;
  if (typeof text !== 'string' || !isRange(candidate.range)) {
    return null;
  }
  const range: LspRange = candidate.range;
  return {
    range: {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    },
    text,
  };
}

/**
 * Determines whether a value is an LSP range.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isRange(value: unknown): value is LspRange {
  const range: { start?: unknown; end?: unknown } | null =
    typeof value === 'object' && value !== null ? value : null;
  return range !== null && isPosition(range.start) && isPosition(range.end);
}

/**
 * Determines whether a value is an LSP position.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isPosition(value: unknown): value is LspPosition {
  const position: { line?: unknown; character?: unknown } | null =
    typeof value === 'object' && value !== null ? value : null;
  return (
    position !== null &&
    Number.isInteger(position.line) &&
    Number.isInteger(position.character) &&
    (position.line as number) >= 0 &&
    (position.character as number) >= 0
  );
}
