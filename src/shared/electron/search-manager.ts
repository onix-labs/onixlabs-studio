import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as nodePath from 'node:path';
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { rgPath } from '@vscode/ripgrep';
import {
  SearchChannel,
  SearchMatch,
  SearchRequest,
  SearchResponse,
  SearchResultFile,
} from '@shared/api/search-channels';
import { WorkspaceContext } from './workspace-context';

/**
 * Caps the number of matches ripgrep is asked to return per file, bounding the work for pathological
 * files (for example a minified bundle on one line).
 */
const MAX_MATCHES_PER_FILE: number = 500;

/**
 * Caps the total number of matches returned across every file, so a broad query cannot flood the
 * renderer. When reached, the search is stopped early and the response is marked capped.
 */
const MAX_TOTAL_MATCHES: number = 5000;

/**
 * Caps the length of each match's line preview, so a long line does not bloat the payload.
 */
const MAX_PREVIEW_LENGTH: number = 240;

/**
 * Caps the number of file paths a listing returns, so an enormous workspace cannot flood the
 * renderer's mention picker.
 */
const MAX_LISTED_FILES: number = 20_000;

/**
 * Describes the shape of the ripgrep `--json` match event this manager consumes. Only the fields the
 * results tree needs are modelled.
 */
interface RipgrepMatchEvent {
  /**
   * Gets the event discriminator; a match event is `'match'`.
   */
  readonly type: string;

  /**
   * Gets the event payload.
   */
  readonly data: {
    readonly path: { readonly text?: string };
    readonly line_number: number;
    readonly lines: { readonly text?: string };
    readonly submatches: readonly {
      readonly start: number;
      readonly end: number;
      readonly match: { readonly text?: string };
    }[];
  };
}

/**
 * Runs workspace text searches in the main process by shelling out to the bundled ripgrep binary.
 * The renderer never spawns processes itself; it names a query and a workspace root, and this manager
 * confines the search to an open root, translates the options to ripgrep flags, parses the streamed
 * `--json` output into matches grouped by file, and returns them capped. The bundled binary is
 * gitignore-aware, so results respect the workspace's ignore rules.
 */
export class SearchManager {
  /**
   * Initializes a new instance of the {@link SearchManager} class.
   * @param workspace The workspace context that decides which roots may be searched.
   */
  public constructor(private readonly workspace: WorkspaceContext) {}

  /**
   * Registers the search IPC handler.
   */
  public register(): void {
    ipcMain.handle(
      SearchChannel.Run,
      (_event: IpcMainInvokeEvent, request: unknown): Promise<SearchResponse> => this.run(request),
    );
    ipcMain.handle(
      SearchChannel.ListFiles,
      (_event: IpcMainInvokeEvent, root: unknown): Promise<readonly string[]> =>
        this.listFiles(root),
    );
  }

  /**
   * Lists a workspace root's files as gitignore-aware relative paths, confined to an open root and
   * capped at {@link MAX_LISTED_FILES}.
   * @param root The candidate workspace root.
   * @returns Returns the relative paths (empty for an invalid or unknown root).
   */
  private listFiles(root: unknown): Promise<readonly string[]> {
    if (typeof root !== 'string' || root.length === 0 || !this.workspace.isRoot(root)) {
      return Promise.resolve([]);
    }
    return new Promise<readonly string[]>((resolve: (value: readonly string[]) => void): void => {
      const child: ChildProcessWithoutNullStreams = spawn(rgPath, ['--files'], { cwd: root });
      const paths: string[] = [];
      let buffer: string = '';
      let settled: boolean = false;

      const finish: () => void = (): void => {
        if (!settled) {
          settled = true;
          resolve(paths);
        }
      };

      child.stdout.on('data', (chunk: Buffer): void => {
        buffer += chunk.toString();
        let newline: number = buffer.indexOf('\n');
        while (newline !== -1) {
          const line: string = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) {
            paths.push(line.startsWith('./') ? line.slice(2) : line);
            if (paths.length >= MAX_LISTED_FILES) {
              child.kill();
              finish();
              return;
            }
          }
          newline = buffer.indexOf('\n');
        }
      });

      child.on('error', (): void => finish());
      child.on('close', (): void => finish());
    });
  }

  /**
   * Runs a search for the given request, after validating it and confining it to an open root.
   * @param request The candidate search request.
   * @returns Returns the grouped matches, or an empty response for an invalid or empty request.
   */
  private run(request: unknown): Promise<SearchResponse> {
    const empty: SearchResponse = { files: [], total: 0, capped: false };
    if (!this.isValidRequest(request)) {
      return Promise.resolve(empty);
    }
    if (request.query.length === 0 || !this.workspace.isRoot(request.root)) {
      return Promise.resolve(empty);
    }
    return this.spawnSearch(request);
  }

  /**
   * Determines whether an unknown value is a well-formed {@link SearchRequest}.
   * @param request The value to check.
   * @returns Returns true when the value has the expected shape.
   */
  private isValidRequest(request: unknown): request is SearchRequest {
    if (typeof request !== 'object' || request === null) {
      return false;
    }
    const candidate: Partial<Record<keyof SearchRequest, unknown>> = request;
    return (
      typeof candidate.query === 'string' &&
      typeof candidate.root === 'string' &&
      typeof candidate.caseSensitive === 'boolean' &&
      typeof candidate.wholeWord === 'boolean' &&
      typeof candidate.regexp === 'boolean'
    );
  }

  /**
   * Spawns ripgrep for a validated request and collects its results.
   * @param request The validated search request.
   * @returns Returns the grouped matches.
   */
  private spawnSearch(request: SearchRequest): Promise<SearchResponse> {
    return new Promise<SearchResponse>((resolve: (value: SearchResponse) => void): void => {
      const child: ChildProcessWithoutNullStreams = spawn(rgPath, this.buildArgs(request), {
        cwd: request.root,
      });
      const files: Map<string, SearchMatch[]> = new Map<string, SearchMatch[]>();
      const order: string[] = [];
      let total: number = 0;
      let capped: boolean = false;
      let buffer: string = '';
      let settled: boolean = false;

      const finish: () => void = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        const results: SearchResultFile[] = order.map(
          (relativePath: string): SearchResultFile => ({
            path: nodePath.join(request.root, relativePath),
            relativePath,
            matches: files.get(relativePath) ?? [],
          }),
        );
        resolve({ files: results, total, capped });
      };

      child.stdout.on('data', (chunk: Buffer): void => {
        buffer += chunk.toString();
        let newline: number = buffer.indexOf('\n');
        while (newline !== -1) {
          const line: string = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (this.consumeLine(line, files, order) && ++total >= MAX_TOTAL_MATCHES) {
            capped = true;
            child.kill();
            finish();
            return;
          }
          newline = buffer.indexOf('\n');
        }
      });

      child.on('error', (): void => finish());
      child.on('close', (): void => finish());
    });
  }

  /**
   * Parses a single ripgrep output line, appending any match it carries to the accumulating results.
   * @param line The raw JSON line.
   * @param files The map of relative path to matches, mutated in place.
   * @param order The list preserving first-seen file order, mutated in place.
   * @returns Returns true when the line contributed a match.
   */
  private consumeLine(line: string, files: Map<string, SearchMatch[]>, order: string[]): boolean {
    if (line.length === 0) {
      return false;
    }
    let event: RipgrepMatchEvent;
    try {
      event = JSON.parse(line) as RipgrepMatchEvent;
    } catch {
      return false;
    }
    if (event.type !== 'match') {
      return false;
    }
    const raw: string | undefined = event.data.path.text;
    if (raw === undefined) {
      return false;
    }
    // ripgrep searches the root as '.', so paths arrive as './src/...'; strip the prefix for display.
    const relativePath: string = raw.startsWith('./') ? raw.slice(2) : raw;
    const lineText: string = (event.data.lines.text ?? '').replace(/\r?\n$/, '');
    const submatch: { start: number; end: number; match: { text?: string } } | undefined =
      event.data.submatches[0];
    const start: number = submatch?.start ?? 0;
    const end: number = submatch?.end ?? start;
    // ripgrep offsets are byte offsets into the line; treated here as character indices, which is
    // exact for ASCII and a harmless preview approximation for multi-byte text.
    const before: string = lineText.slice(Math.max(0, start - MAX_PREVIEW_LENGTH), start);
    const text: string = submatch?.match.text ?? lineText.slice(start, end);
    const after: string = lineText.slice(end, end + MAX_PREVIEW_LENGTH);
    const match: SearchMatch = {
      line: event.data.line_number,
      column: start + 1,
      before,
      text,
      after,
    };
    let matches: SearchMatch[] | undefined = files.get(relativePath);
    if (matches === undefined) {
      matches = [];
      files.set(relativePath, matches);
      order.push(relativePath);
    }
    matches.push(match);
    return true;
  }

  /**
   * Builds the ripgrep argument list for a request. A leading `--` stops flag parsing, so a query
   * beginning with a dash is searched literally rather than treated as an option.
   * @param request The validated search request.
   * @returns Returns the argument list.
   */
  private buildArgs(request: SearchRequest): string[] {
    const args: string[] = ['--json', `--max-count=${MAX_MATCHES_PER_FILE}`];
    args.push(request.caseSensitive ? '--case-sensitive' : '--ignore-case');
    if (request.wholeWord) {
      args.push('--word-regexp');
    }
    if (!request.regexp) {
      args.push('--fixed-strings');
    }
    args.push('--', request.query, '.');
    return args;
  }
}
