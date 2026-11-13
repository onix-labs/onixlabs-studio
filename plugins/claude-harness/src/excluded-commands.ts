// Excluded commands (#1163), as the Claude harness reads them: the patterns the user declared may run
// outside the sandbox, in Bash permission-rule syntax. A copy rather than an import of Studio's own
// module, as for the protocol: the harness is a separate program whose contract with Studio is the wire.

/**
 * Holds the longest pattern accepted.
 */
const MAX_PATTERN_LENGTH: number = 200;

/**
 * Determines whether a pattern is one this harness understands: an exact command, or a prefix written
 * `<command>:*`. Anything else (a bare `*`, a wildcard mid-pattern) is dropped, so it can neither
 * exclude every command nor be read differently here and in the SDK.
 * @param pattern The pattern.
 * @returns Returns true when it is understood.
 */
function isUnderstood(pattern: string): boolean {
  if (pattern === '' || pattern.length > MAX_PATTERN_LENGTH || /[\n\r\0]/.test(pattern)) {
    return false;
  }
  const command: string = pattern.endsWith(':*') ? pattern.slice(0, -2) : pattern;
  return command.trim() !== '' && !command.includes('*');
}

/**
 * Reads a turn's excluded commands, keeping the ones this harness understands.
 * @param turn The turn, or anything carrying its excluded commands.
 * @returns Returns the patterns, empty for an older Studio or none configured.
 */
export function excludedCommandsOf(turn: {
  readonly excludedCommands?: readonly string[];
}): readonly string[] {
  const value: unknown = turn.excludedCommands;
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set<string>(
      value
        .filter((entry: unknown): entry is string => typeof entry === 'string')
        .map((entry: string): string => entry.trim().replace(/\s+/g, ' '))
        .filter(isUnderstood),
    ),
  ];
}

/**
 * Determines whether a shell command is excluded: equal to an exact pattern, or equal to or starting
 * with a prefix pattern's command and a space.
 * @param command The command line.
 * @param patterns The turn's patterns.
 * @returns Returns true when one of them excludes it.
 */
export function isExcludedCommand(command: string, patterns: readonly string[]): boolean {
  const line: string = command.trim().replace(/\s+/g, ' ');
  return patterns.some((pattern: string): boolean => {
    if (pattern.endsWith(':*')) {
      const prefix: string = pattern.slice(0, -2);
      return line === prefix || line.startsWith(`${prefix} `);
    }
    return line === pattern;
  });
}
