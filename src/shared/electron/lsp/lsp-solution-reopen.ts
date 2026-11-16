import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LspPostInitialize } from './language-server-descriptor';

/**
 * The notification that tells Roslyn which solution to load.
 */
const SOLUTION_OPEN: string = 'solution/open';

/**
 * Decides when a server that was told which solution to open has to be told again.
 *
 * ⛔ Roslyn does not watch the solution file. A project added to it (`dotnet sln add`), removed or
 * renamed is never loaded: the server reports nothing about the change, and a file of the new project
 * opens in its miscellaneous-files project, where every reference is missing and a `using` the file
 * plainly needs is reported unnecessary. Sending `solution/open` again reloads the solution, which is
 * what it takes (probed against Roslyn 5.13). Only a change to what the file says counts, so
 * a checkout that rewrites it unchanged does not reload a large solution for nothing.
 */
export class SolutionReopener {
  /**
   * Holds the solution file's absolute path, or null when the server was not told to open one.
   */
  private readonly solution: string | null;

  /**
   * Holds the messages that open it, sent again on a change.
   */
  private readonly messages: readonly LspPostInitialize[];

  /**
   * Holds what the solution file said when last opened, or null when it could not be read.
   */
  private content: string | null;

  /**
   * Initializes a new instance of the {@link SolutionReopener} class, reading the solution as it is.
   * @param postInitialize The messages the server was sent once its handshake completed.
   * @param read Reads a file's text, or throws; overridable for tests.
   */
  public constructor(
    postInitialize: readonly LspPostInitialize[] | undefined,
    private readonly read: (file: string) => string = (file: string): string =>
      readFileSync(file, 'utf8'),
  ) {
    this.messages = (postInitialize ?? []).filter(
      (message: LspPostInitialize): boolean => message.method === SOLUTION_OPEN,
    );
    this.solution = solutionPathOf(this.messages[0]);
    this.content = this.solution === null ? null : this.tryRead(this.solution);
  }

  /**
   * Decides, from a batch of changed paths, whether the solution must be opened again.
   * @param root The absolute watched root the paths are relative to.
   * @param relativePaths The changed paths, relative to the root.
   * @returns Returns the messages to send again, or an empty list when nothing needs reopening.
   */
  public reopenFor(root: string, relativePaths: readonly string[]): readonly LspPostInitialize[] {
    const solution: string | null = this.solution;
    if (solution === null) {
      return [];
    }
    const touched: boolean = relativePaths.some(
      (relative: string): boolean => path.resolve(root, relative) === solution,
    );
    if (!touched) {
      return [];
    }
    const content: string | null = this.tryRead(solution);
    // A solution deleted (or mid-replace) is not reopened; its reappearance is the next change.
    if (content === null || content === this.content) {
      return [];
    }
    this.content = content;
    return this.messages;
  }

  /**
   * Reads a file, or answers null when it cannot be read.
   * @param file The absolute path.
   * @returns Returns the text, or null.
   */
  private tryRead(file: string): string | null {
    try {
      return this.read(file);
    } catch {
      return null;
    }
  }
}

/**
 * Takes the solution's path from a `solution/open` message.
 * @param message The message, or undefined.
 * @returns Returns the absolute path, or null when the message names no usable `file:` URI.
 */
function solutionPathOf(message: LspPostInitialize | undefined): string | null {
  const uri: unknown = (message?.params as { solution?: unknown } | undefined)?.solution;
  if (typeof uri !== 'string') {
    return null;
  }
  try {
    return path.resolve(fileURLToPath(uri));
  } catch {
    return null;
  }
}
