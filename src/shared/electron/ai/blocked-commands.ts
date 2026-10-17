/**
 * Splits a command line into the commands it runs: at `;`, `&`, `|`, newlines, parentheses,
 * backticks and `$(`, so `cd x && gh pr list` and `echo $(gh auth token)` each yield the `gh` call.
 */
const COMMAND_SEPARATOR: RegExp = /\$\(|[;&|()`\n]/;

/**
 * The words that run the command after them rather than being it, skipped when finding which program
 * a command runs: privilege and environment wrappers, and the shells and launchers whose argument is
 * itself a command — `sh -c "gh auth token"`, `eval gh …`, `npx gh` — so the program they are given
 * is the program that is checked (audit S10).
 */
const WRAPPERS: ReadonlySet<string> = new Set<string>([
  'sudo',
  'doas',
  'env',
  'exec',
  'command',
  'builtin',
  'time',
  'nohup',
  'nice',
  'xargs',
  'eval',
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'npx',
  'pnpx',
  'bunx',
  'yarn',
]);

/**
 * `find`'s way of running a command for each match, which starts a new command as surely as `;` does.
 */
const FIND_EXEC: RegExp = /\s-exec(?:dir)?\s/g;

/**
 * Matches a word that assigns a value — `NAME=value` before a program, or an option's `key=value` —
 * capturing the value, so a blocked program smuggled in as a value (`G=gh; $G auth`,
 * `git -c core.pager=gh log`) is found where it is named rather than where it is used.
 */
const ASSIGNMENT: RegExp = /^[^\s=]+=(.*)$/;

/**
 * Finds the first blocked command a command line would run (#853). It looks at every command in the
 * line — after separators, past environment assignments and wrappers such as `sudo`, `env` and
 * `sh -c` — and compares the program's name with quotes and escapes removed, so `/usr/local/bin/gh`,
 * `"gh"`, `g\h` and `'g'h` are all `gh`. A best effort over shell syntax, not a shell parser: it errs
 * towards refusing (a quoted `"gh"` argument after a separator counts, as does a value naming it),
 * because the cost of a false refusal is the agent using the plugin's tool, which is the point.
 * @param commandLine The command line.
 * @param blocked The blocked command names.
 * @returns Returns the blocked command found, or null when the line runs none.
 */
export function findBlockedCommand(commandLine: string, blocked: readonly string[]): string | null {
  if (blocked.length === 0) {
    return null;
  }
  const names: (word: string) => string = (word: string): string => {
    const bare: string = word.replace(/\\/g, '').replace(/["']/g, '');
    return bare.slice(bare.lastIndexOf('/') + 1);
  };
  for (const segment of commandLine.replace(FIND_EXEC, ';').split(COMMAND_SEPARATOR)) {
    const words: string[] = segment
      .trim()
      .split(/\s+/)
      .filter((word: string) => word.length > 0);
    // A value anywhere in the command that names a blocked program: an assignment before it, or an
    // option's value after it (`git -c core.pager=gh log`).
    for (const word of words) {
      const assignment: RegExpExecArray | null = ASSIGNMENT.exec(
        word.replace(/\\/g, '').replace(/["']/g, ''),
      );
      if (assignment !== null && blocked.includes(names(assignment[1]))) {
        return names(assignment[1]);
      }
    }
    let index: number = 0;
    while (index < words.length) {
      const word: string = words[index].replace(/\\/g, '').replace(/["']/g, '');
      if (ASSIGNMENT.test(word) || WRAPPERS.has(word) || word.startsWith('-')) {
        index++;
        continue;
      }
      break;
    }
    const program: string | undefined = words[index];
    if (program === undefined) {
      continue;
    }
    const name: string = names(program);
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
  return `\`${command}\` is blocked for agents in this workspace: Studio's hosting plugin serves this repository. Use the hosting_* tools instead — they ask the user before changing anything. (The user can allow it again under Settings ▸ Artificial Intelligence ▸ Security & Permissions.)`;
}
