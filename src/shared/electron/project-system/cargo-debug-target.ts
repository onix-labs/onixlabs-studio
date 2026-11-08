/**
 * How a Cargo command is turned into the build that produces what it would run (#1210): the program
 * that runs and the arguments it is given.
 */
export interface CargoDebugBuild {
  /**
   * Gets the arguments that build it, without running it, and report what was built as JSON.
   */
  readonly build: readonly string[];

  /**
   * Gets the arguments the built program is run with: what came after `--`.
   */
  readonly executableArgs: readonly string[];

  /**
   * Gets whether what is built is a test harness, rather than a binary.
   */
  readonly test: boolean;
}

/**
 * Reads the Cargo command a Run lens or a run configuration gives — `test --package shapes --lib --
 * tests::area --exact` — as the build that produces the program it would run, for the debugger to
 * launch (#1210). `cargo test` and `cargo bench` are built with `--no-run`, and `cargo run` becomes
 * `cargo build`. Anything else, a doc test among them, cannot be debugged.
 * @param args The arguments given to `cargo`.
 * @returns Returns the build, or null when the command builds nothing a debugger can launch.
 */
export function cargoDebugBuild(args: readonly string[]): CargoDebugBuild | null {
  const separator: number = args.indexOf('--');
  const cargoArgs: readonly string[] = separator === -1 ? args : args.slice(0, separator);
  const executableArgs: readonly string[] = separator === -1 ? [] : args.slice(separator + 1);
  const [subcommand, ...rest] = cargoArgs;
  // A doc test is compiled and run by rustdoc, with no program left behind to launch.
  if (rest.includes('--doc')) {
    return null;
  }
  const report: readonly string[] = ['--message-format=json'];
  if (subcommand === 'test' || subcommand === 'bench') {
    return {
      build: [subcommand, ...rest, '--no-run', ...report],
      executableArgs,
      test: true,
    };
  }
  if (subcommand === 'run') {
    return { build: ['build', ...rest, ...report], executableArgs, test: false };
  }
  return null;
}

/**
 * Finds the programs a Cargo build produced, from the JSON messages it reported (#1210): the test
 * harnesses for a test build, the binaries and examples for a run build. A debugger launches one, so
 * anything but exactly one is for the caller to refuse.
 * @param stdout What `cargo … --message-format=json` wrote, one message per line.
 * @param test Whether test harnesses are wanted.
 * @returns Returns the programs' paths, each once, in the order built.
 */
export function builtPrograms(stdout: string, test: boolean): readonly string[] {
  const found: Set<string> = new Set<string>();
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) {
      continue;
    }
    let message: {
      reason?: unknown;
      executable?: unknown;
      profile?: { test?: unknown };
      target?: { kind?: unknown };
    };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      continue;
    }
    if (message.reason !== 'compiler-artifact' || typeof message.executable !== 'string') {
      continue;
    }
    const kinds: unknown = message.target?.kind;
    const wanted: boolean = test
      ? message.profile?.test === true
      : Array.isArray(kinds) &&
        kinds.some((kind: unknown): boolean => kind === 'bin' || kind === 'example');
    if (wanted) {
      found.add(message.executable);
    }
  }
  return [...found];
}

/**
 * Reads why a Cargo build failed from its JSON messages: the compiler's own rendering of each error,
 * as it would show in a terminal, so the debug output says what to fix rather than only that it failed.
 * @param stdout What `cargo … --message-format=json` wrote.
 * @returns Returns the rendered errors, or an empty string when it reported none.
 */
export function cargoBuildErrors(stdout: string): string {
  const errors: string[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) {
      continue;
    }
    try {
      const message: { reason?: unknown; message?: { level?: unknown; rendered?: unknown } } =
        JSON.parse(line) as typeof message;
      if (
        message.reason === 'compiler-message' &&
        message.message?.level === 'error' &&
        typeof message.message.rendered === 'string'
      ) {
        errors.push(message.message.rendered.trimEnd());
      }
    } catch {
      // Not a message of Cargo's; skipped.
    }
  }
  return errors.join('\n\n');
}
