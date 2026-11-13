/**
 * Excluded commands (#1163): shell command patterns the user declares, which a Claude agent's sandbox
 * runs outside it. Excluding a command removes the sandbox, not the approval: the command still goes
 * through the permission flow, as the SDK's `sandbox.excludedCommands` documents.
 *
 * Patterns use Claude Code's Bash permission-rule syntax, of which this accepts the two shapes the
 * feature needs: an exact command (`make build`) and a prefix (`npx ng:*`, matching `npx ng` and
 * anything after it). Keep this module platform-neutral: the renderer validates with it, the main
 * process sanitises with it, and the Claude harness keeps its own copy of the matcher.
 */

/**
 * Holds the longest pattern accepted. A command line long enough to need more is not a pattern.
 */
const MAX_PATTERN_LENGTH: number = 200;

/**
 * Holds the most patterns one list may carry, bounding untrusted input.
 */
const MAX_PATTERNS: number = 200;

/**
 * Holds the launchers whose first argument is the actual tool, so a suggestion excludes `npx ng`
 * rather than every `npx` command.
 */
const LAUNCHERS: ReadonlySet<string> = new Set<string>([
  'npx',
  'pnpm',
  'yarn',
  'bunx',
  'bun',
  'npm',
  'pnpx',
]);

/**
 * Holds the crash signatures macOS's sandbox leaves when a toolchain cannot run under it at all: the
 * dynamic loader refusing, or the process aborting.
 */
const SANDBOX_CRASH_SIGNATURES: readonly RegExp[] = [
  /\bdyld\b/i,
  /\bSIGABRT\b/,
  /\bAbort trap\b/i,
  /\bTrace\/BPT trap\b/i,
];

/**
 * Reduces a typed pattern to its canonical form: trimmed, with runs of whitespace collapsed, and a
 * prefix written as `<command>:*` with no space before the colon.
 * @param value The pattern as typed.
 * @returns Returns the canonical pattern, or an empty string when nothing usable remains.
 */
export function normaliseExcludedCommand(value: string): string {
  const collapsed: string = value.trim().replace(/\s+/g, ' ');
  return collapsed.replace(/\s*:\s*\*$/, ':*');
}

/**
 * Determines whether a canonical pattern may be stored and handed to the sandbox. A pattern that
 * names no command (`*`, `:*`) would take every command out of the sandbox, which is no boundary.
 * @param pattern The canonical pattern.
 * @returns Returns true when the pattern is acceptable.
 */
export function isValidExcludedCommand(pattern: string): boolean {
  if (pattern === '' || pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  const command: string = pattern.endsWith(':*') ? pattern.slice(0, -2) : pattern;
  if (command.trim() === '' || /^[*\s]*$/.test(command)) {
    return false;
  }
  // A wildcard is only understood as the trailing `:*`; anywhere else it would be a literal the user
  // did not mean.
  return !command.includes('*') && !/[\n\r\0]/.test(command);
}

/**
 * Cleans a list of patterns from settings, a file or an untrusted request.
 * @param value The configured value.
 * @returns Returns the canonical, valid patterns, without duplicates.
 */
export function sanitizeExcludedCommands(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const patterns: string[] = value
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry: string): string => normaliseExcludedCommand(entry))
    .filter((entry: string): boolean => isValidExcludedCommand(entry));
  return [...new Set<string>(patterns)].slice(0, MAX_PATTERNS);
}

/**
 * Determines whether a command line is excluded by a pattern: equal to an exact pattern, or equal to
 * a prefix pattern's command or starting with it followed by a space.
 * @param command The command line, as the agent ran it.
 * @param pattern A canonical pattern.
 * @returns Returns true when the pattern excludes the command.
 */
export function excludedCommandMatches(command: string, pattern: string): boolean {
  const line: string = command.trim().replace(/\s+/g, ' ');
  if (pattern.endsWith(':*')) {
    const prefix: string = pattern.slice(0, -2);
    return line === prefix || line.startsWith(`${prefix} `);
  }
  return line === pattern;
}

/**
 * Determines whether any of a list of patterns excludes a command line.
 * @param command The command line.
 * @param patterns The canonical patterns.
 * @returns Returns true when one of them excludes it.
 */
export function isExcludedCommand(command: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern: string): boolean => excludedCommandMatches(command, pattern));
}

/**
 * Determines whether a failed command's output carries a sandbox crash signature, the case where
 * excluding it is the fix.
 * @param output The command's output.
 * @returns Returns true when the output looks like a sandbox crash.
 */
export function looksLikeSandboxCrash(output: string): boolean {
  return SANDBOX_CRASH_SIGNATURES.some((signature: RegExp): boolean => signature.test(output));
}

/**
 * Suggests the pattern to exclude for a command that crashed in the sandbox: its first word, or its
 * first two when the first is a launcher (`npx ng`, `npm run`), as a prefix.
 * @param command The command line.
 * @returns Returns the pattern, or null when the command names nothing to exclude.
 */
export function suggestExcludedCommand(command: string): string | null {
  // Only the first command of a chain or pipeline is the one that ran first; environment assignments
  // (`FOO=1 cmd`) are not the command.
  const first: string = command.trim().split(/&&|\|\||;|\|/)[0] ?? '';
  const words: string[] = first
    .trim()
    .split(/\s+/)
    .filter((word: string): boolean => word !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (words.length === 0) {
    return null;
  }
  const head: string[] =
    LAUNCHERS.has(words[0]) && words.length > 1 && !words[1].startsWith('-')
      ? words.slice(0, 2)
      : words.slice(0, 1);
  const pattern: string = normaliseExcludedCommand(`${head.join(' ')}:*`);
  return isValidExcludedCommand(pattern) ? pattern : null;
}
