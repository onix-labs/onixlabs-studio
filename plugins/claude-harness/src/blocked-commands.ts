/**
 * Splits a command line into the commands it runs: at `;`, `&`, `|`, line ends, parentheses,
 * backticks and `$(`, so `cd x && gh pr list` and `echo $(gh auth token)` each yield the `gh` call.
 */
const COMMAND_SEPARATOR: RegExp = /\$\(|[;&|()`\n\r]/;

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
  'timeout',
  'gtimeout',
  'setsid',
  'stdbuf',
  // Not programs at all, but what stands between a separator and the program it starts:
  // `if true; then gh …`, `! gh …`, `{ gh …; }`.
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  '!',
  '{',
]);

/**
 * The options of each wrapper whose value is the next word, so that word is stepped over rather than
 * taken for the program: in `sudo -u root gh`, the program is `gh`, not `root`. Deliberately missing
 * are the options whose value is the command (`sh -c`, `env -S`), because there the next word is
 * the thing to check.
 */
const VALUE_OPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>(
  Object.entries({
    sudo: [
      '-a',
      '-C',
      '-c',
      '-D',
      '-g',
      '-h',
      '-p',
      '-R',
      '-r',
      '-T',
      '-t',
      '-U',
      '-u',
      '--auth-type',
      '--chdir',
      '--chroot',
      '--close-from',
      '--command-timeout',
      '--group',
      '--host',
      '--login-class',
      '--other-user',
      '--prompt',
      '--role',
      '--type',
      '--user',
    ],
    doas: ['-C', '-u'],
    env: ['-a', '-C', '-P', '-u', '--argv0', '--chdir', '--unset'],
    exec: ['-a'],
    time: ['-f', '-o', '--format', '--output'],
    nice: ['-n', '--adjustment'],
    xargs: [
      '-a',
      '-d',
      '-E',
      '-I',
      '-J',
      '-L',
      '-n',
      '-P',
      '-R',
      '-S',
      '-s',
      '--arg-file',
      '--delimiter',
      '--max-args',
      '--max-chars',
      '--max-lines',
      '--max-procs',
    ],
    sh: ['-O', '-o'],
    bash: ['-O', '-o', '--init-file', '--rcfile'],
    zsh: ['-o'],
    dash: ['-o'],
    ksh: ['-o'],
    npx: ['-p', '--package'],
    pnpx: ['-p', '--package'],
    bunx: ['-p', '--package'],
    yarn: ['--cwd'],
    timeout: ['-k', '-s', '--kill-after', '--signal'],
    gtimeout: ['-k', '-s', '--kill-after', '--signal'],
    stdbuf: ['-e', '-i', '-o', '--error', '--input', '--output'],
  }).map(([wrapper, options]: [string, string[]]): [string, ReadonlySet<string>] => [
    wrapper,
    new Set<string>(options),
  ]),
);

/**
 * The wrappers whose first plain word is a value of theirs: the duration of `timeout 5 gh`.
 */
const LEADING_VALUE: ReadonlySet<string> = new Set<string>(['timeout', 'gtimeout']);

/**
 * Matches a redirection standing alone, whose target is the next word: `> out gh`.
 */
const REDIRECTION_ALONE: RegExp = /^\d*(?:>>?|<)$/;

/**
 * Matches a redirection and its attached target: `>out gh`, `2>/dev/null gh`.
 */
const REDIRECTION: RegExp = /^\d*[<>]/;

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
    const program: string | undefined = words[programIndex(words, names)];
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
 * Finds which word of a command is the program it runs, stepping over assignments, redirections,
 * wrappers, their options and those options' values.
 * @param words The command's words.
 * @param names Reduces a word to the bare program name it stands for.
 * @returns Returns the program's index, or the word count when the command names no program.
 */
function programIndex(words: readonly string[], names: (word: string) => string): number {
  let wrapper: string | null = null;
  let awaitingValue: boolean = false;
  let index: number = 0;
  while (index < words.length) {
    const word: string = words[index].replace(/\\/g, '').replace(/["']/g, '');
    if (REDIRECTION_ALONE.test(word)) {
      index += 2;
    } else if (REDIRECTION.test(word) || ASSIGNMENT.test(word)) {
      index += 1;
    } else if (WRAPPERS.has(names(word))) {
      // By name, so `/usr/bin/env gh` is the same wrapper as `env gh`.
      wrapper = names(word);
      awaitingValue = LEADING_VALUE.has(wrapper);
      index += 1;
    } else if (word.startsWith('-')) {
      index += takesNextWord(wrapper, word) ? 2 : 1;
    } else if (awaitingValue) {
      awaitingValue = false;
      index += 1;
    } else {
      break;
    }
  }
  return index;
}

/**
 * Decides whether an option's value is the word after it. Short options follow getopt: the first
 * letter of a cluster that takes a value takes the rest of the word as that value, so `-Eu root` needs
 * the next word and `-uroot` does not — and in `-uroot gh`, stepping over the next word would step
 * over the program.
 * @param wrapper The wrapper the option belongs to, or null when there is none.
 * @param option The option.
 * @returns Returns true when the next word is the option's value.
 */
function takesNextWord(wrapper: string | null, option: string): boolean {
  const options: ReadonlySet<string> | undefined =
    wrapper === null ? undefined : VALUE_OPTIONS.get(wrapper);
  if (options === undefined) {
    return false;
  }
  if (option.startsWith('--')) {
    return options.has(option);
  }
  for (let at: number = 1; at < option.length; at++) {
    if (options.has(`-${option[at]}`)) {
      return at === option.length - 1;
    }
  }
  return false;
}

/**
 * Says why a command was refused, for the model to read.
 * @param command The blocked command.
 * @returns Returns the explanation.
 */
export function blockedCommandMessage(command: string): string {
  return `\`${command}\` is blocked for agents in this workspace: Studio's hosting plugin serves this repository. Use the hosting_* tools instead — they ask the user before changing anything. (The user can allow it again under Settings ▸ Artificial Intelligence ▸ Security & Permissions.)`;
}
