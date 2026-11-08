import { logger } from '../logger';

/**
 * The part of a server connection the check uses.
 */
export interface ProjectDiagnosticsConnection {
  /**
   * Sends a request.
   * @param method The method.
   * @param params The parameters.
   * @returns Returns the server's answer.
   */
  sendRequest(method: string, params: unknown): Promise<unknown>;
}

/**
 * How long a session must go without a document opening or saving before its projects are checked, so
 * a burst (a workspace restoring its tabs, Save All) asks once.
 */
const QUIET_MS: number = 1_000;

/**
 * typescript-language-server's command that hands a request to tsserver as it is (#1207).
 */
const TSSERVER_REQUEST: string = 'typescript.tsserverRequest';

/**
 * Where tsserver says an inferred project's configuration is: a file with no `tsconfig.json` or
 * `jsconfig.json` above it. Such a project holds the open files only, which the server already reports.
 */
const INFERRED_PROJECT: string = '/dev/null/';

/**
 * Has typescript-language-server report every file of the projects the open documents are in (#1207),
 * not only the open documents, so the Error List shows what a save broke in a file that is not open.
 *
 * The server pushes diagnostics only for open files and offers no `workspace/diagnostic`, but tsserver
 * checks a whole project when asked (`geterrForProject`), and the server publishes what it finds for
 * each of the project's files, open or not. It reaches tsserver through the server's
 * `typescript.tsserverRequest` command, as VS Code's project diagnostics do.
 *
 * A project is checked once however many of its files are open: each open document's project is asked
 * for first (`projectInfo`), and one file per project is checked. A check asked for while one runs runs
 * again once it ends, rather than alongside it.
 */
export class ProjectDiagnosticsCheck {
  /**
   * Holds the timer of a check waiting for quiet, or null when none waits.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether a check is running.
   */
  private running: boolean = false;

  /**
   * Holds whether a check was asked for while one was running.
   */
  private again: boolean = false;

  /**
   * Holds whether the check has been stopped, for good.
   */
  private stopped: boolean = false;

  /**
   * Initializes a new instance of the {@link ProjectDiagnosticsCheck} class.
   * @param connection The server connection.
   * @param openDocuments Lists the URIs of the documents open on the server.
   * @param sessionId The session, for the log.
   */
  public constructor(
    private readonly connection: ProjectDiagnosticsConnection,
    private readonly openDocuments: () => readonly string[],
    private readonly sessionId: string,
  ) {}

  /**
   * Asks for a check once the session has been quiet for {@link QUIET_MS}: a document opened or saved.
   */
  public schedule(): void {
    if (this.stopped) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.run();
    }, QUIET_MS);
  }

  /**
   * Stops the check: one waiting is dropped, and one running sends nothing more.
   */
  public stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Checks each project an open document is in, one after another.
   * @returns Returns a promise that resolves once every project has been checked.
   */
  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      const files: readonly string[] = await this.oneFilePerProject();
      for (const file of files) {
        if (this.stopped) {
          return;
        }
        // `isAsync` because tsserver answers this with events and a completion, not a response; the
        // server publishes each file's diagnostics as the events arrive.
        await this.connection.sendRequest('workspace/executeCommand', {
          command: TSSERVER_REQUEST,
          arguments: ['geterrForProject', { file, delay: 0 }, { isAsync: true, lowPriority: true }],
        });
      }
      logger.debug(
        'ProjectDiagnosticsCheck',
        `Checked ${files.length} project(s) for session ${this.sessionId}`,
      );
    } catch (error: unknown) {
      logger.debug('ProjectDiagnosticsCheck', `Project check failed for ${this.sessionId}`, error);
    } finally {
      this.running = false;
      if (this.again && !this.stopped) {
        this.again = false;
        this.schedule();
      }
    }
  }

  /**
   * Chooses one open document from each project the open documents are in, leaving out inferred
   * projects, whose files are the open ones the server reports anyway.
   * @returns Returns the documents' URIs.
   */
  private async oneFilePerProject(): Promise<readonly string[]> {
    const chosen: Map<string, string> = new Map<string, string>();
    for (const uri of this.openDocuments()) {
      if (this.stopped) {
        break;
      }
      const answer: unknown = await this.connection.sendRequest('workspace/executeCommand', {
        command: TSSERVER_REQUEST,
        arguments: ['projectInfo', { file: uri, needFileNameList: false }],
      });
      const config: unknown = (answer as { body?: { configFileName?: unknown } } | null)?.body
        ?.configFileName;
      if (
        typeof config === 'string' &&
        !config.startsWith(INFERRED_PROJECT) &&
        !chosen.has(config)
      ) {
        chosen.set(config, uri);
      }
    }
    return [...chosen.values()];
  }
}
