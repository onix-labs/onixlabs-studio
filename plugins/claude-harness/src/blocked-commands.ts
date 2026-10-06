// Which commands a turn blocks the agent from running (#853), checked against a Bash command line.
//
// A copy of Studio's own matcher rather than an import of it: the harness is a separate program whose
// contract with Studio is the agent protocol, not shared TypeScript — the rule every plugin follows.

/**
 * Splits a command line into the commands it runs: at `;`, `&`, `|`, newlines, parentheses,
 * backticks and `$(`, so `cd x && gh pr list` and `echo $(gh auth token)` each yield the `gh` call.
 */
const COMMAND_SEPARATOR: RegExp = /\$\(|[;&|()`\n]/;

/**
 * The words that run the command after them rather than being it, skipped when finding which program
 * a command runs.
 */
const WRAPPERS: ReadonlySet<string> = new Set<string>([
  'sudo',
  'env',
  'exec',
  'command',
  'builtin',
  'time',
  'nohup',
  'nice',
  'xargs',
]);

/**
 * Matches a leading environment assignment, `NAME=value`, which precedes the program a command runs.
 */
const ASSIGNMENT: RegExp = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Finds the first blocked command a command line would run (#853). It looks at every command in the
 * line — after separators, past environment assignments and wrappers such as `sudo` and `env` — and
 * compares the program's name, so `/usr/local/bin/gh` is `gh`. A best effort over shell syntax, not a
 * shell parser: it errs towards refusing (a quoted `"gh"` argument after a separator counts), because
 * the cost of a false refusal is the agent using the plugin's tool, which is the point.
 * @param commandLine The command line.
 * @param blocked The blocked command names.
 * @returns Returns the blocked command found, or null when the line runs none.
 */
export function findBlockedCommand(commandLine: string, blocked: readonly string[]): string | null {
  if (blocked.length === 0) {
    return null;
  }
  for (const segment of commandLine.split(COMMAND_SEPARATOR)) {
    const words: string[] = segment
      .trim()
      .split(/\s+/)
      .filter((word: string) => word.length > 0);
    let index: number = 0;
    while (
      index < words.length &&
      (ASSIGNMENT.test(words[index]) || WRAPPERS.has(words[index]) || words[index].startsWith('-'))
    ) {
      index++;
    }
    const program: string | undefined = words[index]?.replace(/^['"]|['"]$/g, '');
    if (program === undefined) {
      continue;
    }
    const name: string = program.slice(program.lastIndexOf('/') + 1);
    if (blocked.includes(name)) {
      return name;
    }
  }
  return null;
}

/**
 * Says why a command was refused, for the model to read.
 * @param command The blocked command.
 * @returns Returns the explanation.
 */
export function blockedCommandMessage(command: string): string {
  return `\`${command}\` is blocked for agents in this workspace: Studio's hosting plugin serves this repository. Use the hosting_* tools instead — they ask the user before changing anything.`;
}
