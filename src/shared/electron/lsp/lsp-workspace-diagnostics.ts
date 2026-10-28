import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc/node';
import { logger } from '../logger';

/**
 * One document's report in a `workspace/diagnostic` answer: its diagnostics (`full`), or word that
 * they have not changed since the result the client last held (`unchanged`).
 */
export interface WorkspaceDocumentReport {
  /**
   * Gets the document's URI.
   */
  readonly uri: string;

  /**
   * Gets whether the report carries the document's diagnostics or says they are unchanged.
   */
  readonly kind: 'full' | 'unchanged';

  /**
   * Gets the document's diagnostics, for a full report.
   */
  readonly items?: readonly unknown[];

  /**
   * Gets the identifier of this result, sent back with the next pull so an unchanged document is
   * answered `unchanged`.
   */
  readonly resultId?: string;
}

/**
 * The part of a server connection the pull uses.
 */
export interface WorkspaceDiagnosticsConnection {
  /**
   * Sends a request, cancellable through a token.
   * @param method The method.
   * @param params The parameters.
   * @param token The cancellation token.
   * @returns Returns the server's answer.
   */
  sendRequest(method: string, params: unknown, token: CancellationToken): Promise<unknown>;
}

/**
 * The shortest time between two pulls, so a server that answers at once rather than holding the
 * request until something changes is not asked in a tight loop.
 */
const MINIMUM_INTERVAL_MS: number = 2_000;

/**
 * How long to wait before pulling again after a pull fails.
 */
const RETRY_MS: number = 5_000;

/**
 * How many pulls in a row may fail before the pull gives up for the session.
 */
const MAX_FAILURES: number = 3;

/**
 * Keeps a server's diagnostics for the whole workspace flowing (#1144) — every file, open or not, as
 * far as the server's own analysis scope reaches.
 *
 * A `workspace/diagnostic` request is held by the server until something changes, and streams its
 * reports as partial results on the request's token as it goes (Roslyn sends one document at a time).
 * So the pull keeps exactly one request open: each report, partial or final, is delivered as it
 * arrives; when the request completes another is sent at once, carrying the result identifiers it
 * holds so only changed documents come back; and when the server says its diagnostics are stale
 * (`workspace/diagnostic/refresh`) the open request is cancelled and a new one sent.
 */
export class WorkspaceDiagnosticsPull {
  /**
   * Holds the last result identifier per document URI.
   */
  private readonly resultIds: Map<string, string> = new Map<string, string>();

  /**
   * Holds the open request's cancellation, or null when none is open.
   */
  private source: CancellationTokenSource | null = null;

  /**
   * Holds the open request's partial-result token, or null when none is open.
   */
  private token: string | null = null;

  /**
   * Counts the requests sent, naming each one's token and telling a late answer from the current one.
   */
  private generation: number = 0;

  /**
   * Holds when the last request was sent.
   */
  private sentAt: number = 0;

  /**
   * Counts the requests in a row that failed.
   */
  private failures: number = 0;

  /**
   * Holds the timer for the next request, or null when none is waiting.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether the pull is running.
   */
  private running: boolean = false;

  /**
   * Initializes a new instance of the {@link WorkspaceDiagnosticsPull} class.
   * @param connection The server connection.
   * @param deliver Receives each batch of document reports, partial or final — or, with `reset`, word to
   * drop every report it holds.
   * @param label Names the session in the log.
   */
  public constructor(
    private readonly connection: WorkspaceDiagnosticsConnection,
    private readonly deliver: (
      reports: readonly WorkspaceDocumentReport[],
      reset?: boolean,
    ) => void,
    private readonly label: string,
  ) {}

  /**
   * Starts pulling; does nothing when already running.
   */
  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.send();
  }

  /**
   * Stops pulling, cancelling the open request.
   */
  public stop(): void {
    this.running = false;
    this.cancel();
  }

  /**
   * Pulls afresh: the server said its diagnostics changed in a way the open request will not report
   * (`workspace/diagnostic/refresh`), or a document closed, so the request is cancelled and another
   * sent.
   * @param forget The URI of a document whose result identifier to drop first, so it comes back in
   * full: Roslyn reports an open document empty, and answers its result identifier `unchanged` after
   * it closes — its text has not changed — leaving its errors unreported.
   */
  public refresh(forget?: string): void {
    if (forget !== undefined) {
      this.resultIds.delete(forget);
    }
    if (!this.running) {
      return;
    }
    this.cancel();
    this.send();
  }

  /**
   * Starts over (#1144): forgets every result identifier, tells the receiver to drop what it holds,
   * and pulls afresh. For a change in what the server reports at all — its analysis scope narrowed to
   * open files, say — after which it simply stops mentioning files whose errors it no longer
   * reports, rather than reporting them empty.
   */
  public reset(): void {
    this.resultIds.clear();
    this.deliver([], true);
    this.refresh();
  }

  /**
   * Determines whether a progress token is the open request's, so its partial results come here
   * rather than to the renderer as a server's own progress.
   * @param token The token of a `$/progress` notification.
   * @returns Returns true when it is.
   */
  public owns(token: unknown): boolean {
    return this.token !== null && token === this.token;
  }

  /**
   * Takes a partial result of the open request.
   * @param value The `$/progress` value: `{ items }`.
   */
  public partial(value: unknown): void {
    this.accept((value as { items?: unknown } | null)?.items);
  }

  /**
   * Sends the next request, no sooner than the minimum interval after the last.
   */
  private send(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const wait: number = Math.max(0, this.sentAt + MINIMUM_INTERVAL_MS - Date.now());
    if (wait > 0) {
      this.timer = setTimeout((): void => {
        this.timer = null;
        this.send();
      }, wait);
      return;
    }
    const generation: number = ++this.generation;
    const token: string = `studio-workspace-diagnostics-${generation}`;
    const source: CancellationTokenSource = new CancellationTokenSource();
    this.source = source;
    this.token = token;
    this.sentAt = Date.now();
    const previousResultIds: { uri: string; value: string }[] = [...this.resultIds].map(
      ([uri, value]: [string, string]): { uri: string; value: string } => ({ uri, value }),
    );
    this.connection
      .sendRequest(
        'workspace/diagnostic',
        { previousResultIds, partialResultToken: token },
        source.token,
      )
      .then((result: unknown): void => {
        if (generation !== this.generation || !this.running) {
          return;
        }
        this.accept((result as { items?: unknown } | null)?.items);
        this.failures = 0;
        this.send();
      })
      .catch((error: unknown): void => {
        if (generation !== this.generation || !this.running) {
          return;
        }
        this.failures += 1;
        if (this.failures >= MAX_FAILURES) {
          logger.warn(
            'WorkspaceDiagnosticsPull',
            `Workspace diagnostics failed ${this.failures} times for ${this.label}; stopping`,
            error,
          );
          this.stop();
          return;
        }
        this.timer = setTimeout((): void => {
          this.timer = null;
          this.send();
        }, RETRY_MS);
      });
  }

  /**
   * Cancels the open request and any waiting one.
   */
  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A cancelled request's late answer is told apart by its generation.
    this.generation += 1;
    this.source?.cancel();
    this.source?.dispose();
    this.source = null;
    this.token = null;
  }

  /**
   * Takes reports: records each document's result identifier and delivers the well-formed ones.
   * @param items The reports, untrusted.
   */
  private accept(items: unknown): void {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }
    const reports: WorkspaceDocumentReport[] = [];
    for (const item of items as readonly unknown[]) {
      const report: Partial<WorkspaceDocumentReport> | null =
        (item as Partial<WorkspaceDocumentReport> | null) ?? null;
      if (
        typeof report?.uri !== 'string' ||
        (report.kind !== 'full' && report.kind !== 'unchanged')
      ) {
        continue;
      }
      if (typeof report.resultId === 'string') {
        this.resultIds.set(report.uri, report.resultId);
      }
      reports.push({
        uri: report.uri,
        kind: report.kind,
        ...(report.kind === 'full' && Array.isArray(report.items) ? { items: report.items } : {}),
        ...(typeof report.resultId === 'string' ? { resultId: report.resultId } : {}),
      });
    }
    if (reports.length > 0) {
      this.deliver(reports);
    }
  }
}
