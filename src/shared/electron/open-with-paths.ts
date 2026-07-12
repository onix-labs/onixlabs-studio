// Pure helpers for the OS "open with" integration: extracting the file paths a launch's command
// line asked the application to open. Kept free of Electron and Node imports so the argument
// filtering can be unit tested.

/**
 * Determines whether a command-line argument looks like an absolute filesystem path (POSIX, Windows
 * drive-letter, or Windows UNC), as opposed to a flag or a relative argument such as the `.` the
 * development launcher passes.
 * @param argument The command-line argument.
 * @returns Returns true when the argument looks like an absolute path.
 */
export function isAbsolutePathArgument(argument: string): boolean {
  return (
    argument.startsWith('/') || /^[A-Za-z]:[\\/]/.test(argument) || argument.startsWith('\\\\')
  );
}

/**
 * Extracts the file paths a launch's command line asked the application to open: the arguments after
 * the executable (and, when running from source, the app-directory argument) that are not flags and
 * look like absolute paths. Whether each path names a real file is for the caller to verify — this
 * filter is pure so it can be tested.
 * @param argv The process arguments (Electron's `process.argv`, or a second instance's argv).
 * @param runningFromSource Whether the application was launched from source (`electron .`), in which
 * case the app-directory argument follows the executable and is skipped too.
 * @returns Returns the candidate file paths, in order.
 */
export function openFilePathsFromArgv(
  argv: readonly string[],
  runningFromSource: boolean,
): string[] {
  const skip: number = runningFromSource ? 2 : 1;
  return argv
    .slice(skip)
    .filter(
      (argument: string): boolean => !argument.startsWith('-') && isAbsolutePathArgument(argument),
    );
}
