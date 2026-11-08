import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LSP_GENERATED_VIEW_KINDS,
  LspGeneratedViewKind,
  LspGeneratedViewResult,
} from '@shared/api/lsp-channels';

/**
 * The folder, inside the one decompiled sources are read from (#1133), that Studio writes the views a
 * server gives into (#1210, #1213). Being inside it, a view opens read-only by the rule that already
 * stands for those, with no new exception to the file boundary (#1305); being a folder of its own, the
 * renderer keeps it away from every language server, which would read an expansion as a stray file.
 */
export const GENERATED_VIEWS_FOLDER: readonly string[] = ['MetadataAsSource', 'StudioViews'];

/**
 * Describes how one kind of view is asked for and shown.
 */
interface GeneratedView {
  /**
   * Gets the request that asks the server for it.
   */
  readonly method: string;

  /**
   * Gets whether the request is about a place in a document, rather than about the server.
   */
  readonly located: boolean;

  /**
   * Turns the server's answer into a document.
   * @param result The answer, untrusted.
   * @param where The document asked about, and the one-based line, for the name.
   * @returns Returns the document's name and text, or null when the answer has nothing to show.
   */
  readonly render: (
    result: unknown,
    where: { readonly file: string; readonly line: number },
  ) => { readonly name: string; readonly text: string } | null;
}

/**
 * The views, by kind. A fixed table: the renderer names a kind, never a request or a file.
 */
const VIEWS: Readonly<Record<LspGeneratedViewKind, GeneratedView>> = {
  expandMacro: {
    method: 'rust-analyzer/expandMacro',
    located: true,
    render: (result: unknown): { name: string; text: string } | null => {
      const { name, expansion } = (result ?? {}) as { name?: unknown; expansion?: unknown };
      if (typeof name !== 'string' || typeof expansion !== 'string') {
        return null;
      }
      return {
        name: `${name} expanded.rs`,
        text: `// Recursive expansion of ${name}\n\n${expansion}`,
      };
    },
  },
  hir: {
    method: 'rust-analyzer/viewHir',
    located: true,
    render: textView('HIR', '.rs'),
  },
  mir: {
    method: 'rust-analyzer/viewMir',
    located: true,
    render: textView('MIR', '.rs'),
  },
  syntaxTree: {
    method: 'textDocument/ast',
    located: true,
    render: (
      result: unknown,
      where: { readonly file: string; readonly line: number },
    ): { name: string; text: string } | null => {
      const lines: string[] = [];
      syntaxTreeLines(result, 0, lines);
      return lines.length === 0
        ? null
        : { name: `${where.file} line ${where.line} AST.txt`, text: `${lines.join('\n')}\n` };
    },
  },
  memoryUsage: {
    method: '$/memoryUsage',
    located: false,
    render: (result: unknown): { name: string; text: string } | null => {
      if (typeof (result as { _total?: unknown } | null)?._total !== 'number') {
        return null;
      }
      const lines: string[] = [];
      memoryLines('Total', result, 0, lines);
      return { name: 'Language server memory usage.txt', text: `${lines.join('\n')}\n` };
    },
  },
};

/**
 * Builds the renderer of a view the server answers as text: rust-analyzer's HIR and MIR.
 * @param label What the text is, for the name.
 * @param extension The extension to name it with, which decides how it is coloured.
 * @returns Returns the renderer.
 */
function textView(label: string, extension: string): GeneratedView['render'] {
  return (
    result: unknown,
    where: { readonly file: string; readonly line: number },
  ): { name: string; text: string } | null =>
    typeof result === 'string' && result.trim().length > 0
      ? { name: `${where.file} line ${where.line} ${label}${extension}`, text: result }
      : null;
}

/**
 * Writes clangd's syntax tree as indented lines (#1213): each node's kind and detail, its role, and
 * where it starts. clangd's `arcana` (its own dump of the node) is left out, as the tree already says it.
 * @param node A node, untrusted.
 * @param depth How deep it is.
 * @param lines The lines so far, appended to.
 */
function syntaxTreeLines(node: unknown, depth: number, lines: string[]): void {
  const candidate: {
    kind?: unknown;
    role?: unknown;
    detail?: unknown;
    range?: { start?: { line?: unknown; character?: unknown } };
    children?: unknown;
  } | null = typeof node === 'object' && node !== null ? node : null;
  if (candidate === null || typeof candidate.kind !== 'string') {
    return;
  }
  const detail: string = typeof candidate.detail === 'string' ? ` ${candidate.detail}` : '';
  const start: { line?: unknown; character?: unknown } | undefined = candidate.range?.start;
  const at: string =
    typeof start?.line === 'number' && typeof start.character === 'number'
      ? ` ${start.line + 1}:${start.character + 1}`
      : '';
  const role: string = typeof candidate.role === 'string' ? candidate.role : '';
  lines.push(`${'  '.repeat(depth)}${candidate.kind}${detail}  [${role}${at}]`);
  if (Array.isArray(candidate.children)) {
    for (const child of candidate.children as unknown[]) {
      syntaxTreeLines(child, depth + 1, lines);
    }
  }
}

/**
 * Writes clangd's memory tree as indented lines (#1213), the biggest first: each part's name and the
 * memory it and everything under it holds. A file's part is named by its path, not its URI.
 * @param name The part's name.
 * @param node The part, untrusted: `_self` and `_total` in bytes, and its parts by name.
 * @param depth How deep it is.
 * @param lines The lines so far, appended to.
 */
function memoryLines(name: string, node: unknown, depth: number, lines: string[]): void {
  const total: unknown = (node as { _total?: unknown } | null)?._total;
  if (typeof total !== 'number') {
    return;
  }
  lines.push(`${'  '.repeat(depth)}${readableName(name)}  ${readableBytes(total)}`);
  const parts: [string, unknown][] = Object.entries(node as Record<string, unknown>).filter(
    ([key, value]: [string, unknown]): boolean =>
      !key.startsWith('_') && typeof (value as { _total?: unknown } | null)?._total === 'number',
  );
  parts.sort(
    (first: [string, unknown], second: [string, unknown]): number =>
      (second[1] as { _total: number })._total - (first[1] as { _total: number })._total,
  );
  for (const [key, value] of parts) {
    memoryLines(key, value, depth + 1, lines);
  }
}

/**
 * Reads a memory part's name: clangd names a file's part by its URI.
 * @param name The name.
 * @returns Returns it, as a path when it is a file URI.
 */
function readableName(name: string): string {
  if (!name.startsWith('file:')) {
    return name;
  }
  try {
    return fileURLToPath(name);
  } catch {
    return name;
  }
}

/**
 * Writes a size in bytes the way a person reads it.
 * @param bytes The size.
 * @returns Returns it in B, KB or MB, one decimal past a kilobyte.
 */
export function readableBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validates what the renderer asks a view of: a kind in the table and, for a view of a place, a
 * document and a position in it, and optionally a range.
 * @param kind The kind, untrusted.
 * @param params The place, untrusted: `{ uri, line, character, endLine?, endCharacter? }`, zero-based.
 * @returns Returns the request to send and what to name the view by, or null when either is invalid.
 */
export function generatedViewRequest(
  kind: unknown,
  params: unknown,
): {
  readonly kind: LspGeneratedViewKind;
  readonly method: string;
  readonly params: unknown;
  readonly where: { readonly file: string; readonly line: number };
} | null {
  if (!LSP_GENERATED_VIEW_KINDS.includes(kind as LspGeneratedViewKind)) {
    return null;
  }
  const view: GeneratedView = VIEWS[kind as LspGeneratedViewKind];
  if (!view.located) {
    return {
      kind: kind as LspGeneratedViewKind,
      method: view.method,
      params: null,
      where: { file: '', line: 0 },
    };
  }
  const place: {
    uri?: unknown;
    line?: unknown;
    character?: unknown;
    endLine?: unknown;
    endCharacter?: unknown;
  } | null = typeof params === 'object' && params !== null ? params : null;
  if (
    typeof place?.uri !== 'string' ||
    !place.uri.startsWith('file:') ||
    !isPosition(place.line) ||
    !isPosition(place.character)
  ) {
    return null;
  }
  let file: string;
  try {
    file = path.basename(fileURLToPath(place.uri));
  } catch {
    return null;
  }
  const start: { line: number; character: number } = {
    line: place.line,
    character: place.character,
  };
  const end: { line: number; character: number } =
    isPosition(place.endLine) && isPosition(place.endCharacter)
      ? { line: place.endLine, character: place.endCharacter }
      : start;
  return {
    kind: kind as LspGeneratedViewKind,
    method: view.method,
    params:
      kind === 'syntaxTree'
        ? { textDocument: { uri: place.uri }, range: { start, end } }
        : { textDocument: { uri: place.uri }, position: start },
    where: { file, line: place.line + 1 },
  };
}

/**
 * Determines whether a value is a zero-based line or character.
 * @param value The value.
 * @returns Returns true when it is a non-negative integer.
 */
function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Turns a server's answer into the document a view shows.
 * @param kind The kind of view.
 * @param result The server's answer, untrusted.
 * @param where The document asked about, and the one-based line.
 * @returns Returns the document's name and text, or null when there is nothing to show.
 */
export function renderGeneratedView(
  kind: LspGeneratedViewKind,
  result: unknown,
  where: { readonly file: string; readonly line: number },
): { readonly name: string; readonly text: string } | null {
  return VIEWS[kind].render(result, where);
}

/**
 * Makes a view's name safe to be a file name: no folder separators, no control characters, nothing
 * Windows refuses, and not too long.
 * @param name The name.
 * @returns Returns the safe name.
 */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned: string = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  const safe: string = cleaned.length === 0 || /^\.+$/.test(cleaned) ? 'view.txt' : cleaned;
  return safe.length > 120 ? safe.slice(safe.length - 120) : safe;
}

/**
 * Writes a view where the editor opens it read-only: a folder of its own under
 * {@link GENERATED_VIEWS_FOLDER}, so asking again opens a fresh tab rather than a stale one.
 * @param view The document.
 * @param temporaryRoot The system temporary directory; overridable for tests.
 * @returns Returns where it was written.
 */
export async function writeGeneratedView(
  view: { readonly name: string; readonly text: string },
  temporaryRoot: string = tmpdir(),
): Promise<LspGeneratedViewResult> {
  const folder: string = path.join(temporaryRoot, ...GENERATED_VIEWS_FOLDER, randomUUID());
  await fs.mkdir(folder, { recursive: true });
  const file: string = path.join(folder, safeFileName(view.name));
  await fs.writeFile(file, view.text, 'utf8');
  return { path: file };
}
