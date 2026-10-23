import { InjectionToken } from '@angular/core';

/**
 * Represents what lets a terminal link the file paths it prints (#1061): finding out whether a path
 * names a file, and opening that file at a position.
 *
 * Provided by a view that has somewhere to open a file — a workspace, whose document well it opens
 * into, and whose roots bound what it will look at. A terminal outside one links web addresses only.
 */
export interface TerminalPathLinks {
  /**
   * Resolves a path a terminal printed to the file it names.
   * @param path The path as printed: absolute, or relative to the terminal's working directory.
   * @param cwd The terminal's working directory, or null when it is not known.
   * @returns Returns the file's absolute path, or null when there is no such file to open here.
   */
  resolve(path: string, cwd: string | null): Promise<string | null>;

  /**
   * Opens a file and, when a line is given, puts the caret there.
   * @param path The file's absolute path, as {@link resolve} gave it.
   * @param line The 1-based line, or null to open the file where it opens.
   * @param column The 1-based column, or null for the start of the line.
   * @returns Returns a promise that resolves once the file is open.
   */
  open(path: string, line: number | null, column: number | null): Promise<void>;
}

/**
 * Provides the view's {@link TerminalPathLinks}. Optional: a terminal in a view that does not provide
 * it links web addresses only.
 */
export const TERMINAL_PATH_LINKS: InjectionToken<TerminalPathLinks> =
  new InjectionToken<TerminalPathLinks>('TERMINAL_PATH_LINKS');
