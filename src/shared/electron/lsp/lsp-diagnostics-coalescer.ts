import { PUBLISH_DIAGNOSTICS_METHOD, WORKSPACE_DIAGNOSTICS_METHOD } from '@shared/api/lsp-channels';
import { WorkspaceDocumentReport } from './lsp-workspace-diagnostics';

/**
 * Specifies how long, in milliseconds, a session's diagnostics gather after one is sent.
 */
export const DIAGNOSTICS_WINDOW_MS: number = 50;

/**
 * Sends one notification to the renderer.
 */
export type DiagnosticsSend = (sessionId: string, method: string, params: unknown) => void;

/**
 * Holds what is gathering for one session, while its window is open.
 */
interface DiagnosticsWindow {
  /**
   * Holds the timer that closes the window.
   */
  readonly timer: NodeJS.Timeout;

  /**
   * Holds the latest `publishDiagnostics` parameters, by document.
   */
  readonly published: Map<string, unknown>;

  /**
   * Holds the workspace pull's latest report, by document.
   */
  readonly reports: Map<string, WorkspaceDocumentReport>;

  /**
   * Holds whether a workspace pull batch is waiting, which it can be with no reports in it.
   */
  hasBatch: boolean;

  /**
   * Holds whether the pull started over.
   */
  reset: boolean;

  /**
   * Holds whether the pull ran to its end.
   */
  complete: boolean;
}

/**
 * Merges a report into those gathered. `unchanged` means the same as the client last held, and what
 * the client is about to hold is the report already here, so a `full` one stands. The newer result
 * identifier still goes with it.
 * @param held The report gathered for the document, if any.
 * @param report The newer report.
 * @returns Returns the report to keep.
 */
function mergeReport(
  held: WorkspaceDocumentReport | undefined,
  report: WorkspaceDocumentReport,
): WorkspaceDocumentReport {
  if (held?.kind === 'full' && report.kind === 'unchanged') {
    return report.resultId === undefined ? held : { ...held, resultId: report.resultId };
  }
  return report;
}

/**
 * Reads the document a `publishDiagnostics` notification is about.
 * @param params The notification's parameters, from the server and untrusted.
 * @returns Returns the document's URI, or undefined when it does not name one.
 */
function uriOf(params: unknown): string | undefined {
  const uri: unknown = (params as { uri?: unknown } | null | undefined)?.uri;
  return typeof uri === 'string' ? uri : undefined;
}

/**
 * Limits how fast a session's diagnostics cross to the renderer.
 *
 * A server re-analysing a project republishes the same documents over and over, and Roslyn streams a
 * workspace pull one document at a time. Each message is a structured clone and a renderer handler,
 * and only the latest for a document says anything. So the first after a quiet spell goes at once,
 * which is the one a person typing is waiting for, and the rest gather for {@link DIAGNOSTICS_WINDOW_MS}
 * with the latest per document winning.
 */
export class LspDiagnosticsCoalescer {
  /**
   * Holds the open windows, by session.
   */
  private readonly windows: Map<string, DiagnosticsWindow> = new Map<string, DiagnosticsWindow>();

  /**
   * Holds how a notification reaches the renderer.
   */
  private readonly send: DiagnosticsSend;

  /**
   * Initializes a new instance of the {@link LspDiagnosticsCoalescer} class.
   * @param send How a notification reaches the renderer.
   */
  public constructor(send: DiagnosticsSend) {
    this.send = send;
  }

  /**
   * Takes a `textDocument/publishDiagnostics` notification.
   * @param sessionId The session.
   * @param params The notification's parameters.
   */
  public publish(sessionId: string, params: unknown): void {
    const uri: string | undefined = uriOf(params);
    const window: DiagnosticsWindow | undefined = this.windows.get(sessionId);
    if (window === undefined || uri === undefined) {
      this.send(sessionId, PUBLISH_DIAGNOSTICS_METHOD, params);
      if (window === undefined) {
        this.open(sessionId);
      }
      return;
    }
    window.published.set(uri, params);
  }

  /**
   * Takes a batch of the workspace pull's reports.
   * @param sessionId The session.
   * @param reports The reports.
   * @param reset Whether the pull started over.
   * @param complete Whether the pull ran to its end.
   */
  public report(
    sessionId: string,
    reports: readonly WorkspaceDocumentReport[],
    reset?: boolean,
    complete?: boolean,
  ): void {
    const window: DiagnosticsWindow | undefined = this.windows.get(sessionId);
    if (window === undefined) {
      this.sendBatch(sessionId, reports, reset === true, complete === true);
      this.open(sessionId);
      return;
    }
    window.hasBatch = true;
    if (reset === true) {
      // Everything gathered belongs to the pull that just ended, as does its having finished.
      window.reports.clear();
      window.reset = true;
      window.complete = false;
    }
    for (const report of reports) {
      window.reports.set(report.uri, mergeReport(window.reports.get(report.uri), report));
    }
    window.complete ||= complete === true;
  }

  /**
   * Sends whatever a session has gathered and closes its window: for a session going away, whose
   * last word must still arrive, and ahead of the news that it has gone.
   * @param sessionId The session.
   */
  public flush(sessionId: string): void {
    const window: DiagnosticsWindow | undefined = this.windows.get(sessionId);
    if (window === undefined) {
      return;
    }
    clearTimeout(window.timer);
    this.windows.delete(sessionId);
    for (const params of window.published.values()) {
      this.send(sessionId, PUBLISH_DIAGNOSTICS_METHOD, params);
    }
    if (window.hasBatch) {
      this.sendBatch(sessionId, [...window.reports.values()], window.reset, window.complete);
    }
  }

  /**
   * Opens a session's window.
   * @param sessionId The session.
   */
  private open(sessionId: string): void {
    const timer: NodeJS.Timeout = setTimeout(
      (): void => this.flush(sessionId),
      DIAGNOSTICS_WINDOW_MS,
    );
    // Never what keeps the app alive at quit.
    timer.unref?.();
    this.windows.set(sessionId, {
      timer,
      published: new Map<string, unknown>(),
      reports: new Map<string, WorkspaceDocumentReport>(),
      hasBatch: false,
      reset: false,
      complete: false,
    });
  }

  /**
   * Sends a batch of the workspace pull's reports.
   * @param sessionId The session.
   * @param reports The reports.
   * @param reset Whether the pull started over.
   * @param complete Whether the pull ran to its end.
   */
  private sendBatch(
    sessionId: string,
    reports: readonly WorkspaceDocumentReport[],
    reset: boolean,
    complete: boolean,
  ): void {
    this.send(sessionId, WORKSPACE_DIAGNOSTICS_METHOD, {
      reports,
      ...(reset ? { reset: true } : {}),
      ...(complete ? { complete: true } : {}),
    });
  }
}
