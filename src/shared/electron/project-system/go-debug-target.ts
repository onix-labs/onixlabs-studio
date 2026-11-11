import * as path from 'node:path';
import type { DebugResolveResult } from '@shared/api/debug-channels';
import type { RunConfiguration } from '@shared/api/studio';

/**
 * The `go build` flags that take their value as the next argument (`-tags integration`), so the value
 * is not mistaken for the package to debug.
 */
const VALUED_BUILD_FLAGS: ReadonlySet<string> = new Set<string>([
  '-tags',
  '-ldflags',
  '-gcflags',
  '-asmflags',
  '-mod',
  '-modfile',
  '-overlay',
  '-pgo',
  '-p',
]);

/**
 * The `go test` flags that a test binary reads, which `go test` passes on with the `-test.` prefix the
 * binary expects (`-run X` is `-test.run X`); Delve's test mode hands its `args` to the binary itself.
 */
const TEST_BINARY_FLAGS: ReadonlySet<string> = new Set<string>([
  'run',
  'skip',
  'v',
  'count',
  'timeout',
  'short',
  'failfast',
  'bench',
  'benchtime',
  'benchmem',
  'cpu',
  'parallel',
  'shuffle',
  'list',
]);

/**
 * The test-binary flags that take their value as the next argument.
 */
const VALUED_TEST_FLAGS: ReadonlySet<string> = new Set<string>([
  'run',
  'skip',
  'count',
  'timeout',
  'bench',
  'benchtime',
  'cpu',
  'parallel',
  'shuffle',
  'list',
]);

/**
 * Determines whether a path lies within a folder.
 * @param candidate The absolute path.
 * @param root The absolute folder.
 * @returns Returns true when the path is the folder or inside it.
 */
function isWithin(candidate: string, root: string): boolean {
  const base: string = path.resolve(root);
  return candidate === base || candidate.startsWith(base + path.sep);
}

/**
 * Reads what a package argument names: a folder or file on disk (`.`, `./cmd/x`, `main.go`), resolved
 * against the configuration's folder and kept within the workspace, or a module import path
 * (`example.com/shapes/cmd`), which Delve resolves itself.
 * @param argument The package argument.
 * @param cwd The configuration's absolute folder.
 * @param root The absolute workspace root.
 * @returns Returns the program to give Delve, or null when it names somewhere outside the workspace.
 */
function packageProgram(argument: string, cwd: string, root: string): string | null {
  const onDisk: boolean =
    argument.startsWith('.') || path.isAbsolute(argument) || argument.endsWith('.go');
  if (!onDisk) {
    return argument;
  }
  const resolved: string = path.resolve(cwd, argument);
  return isWithin(resolved, root) ? resolved : null;
}

/**
 * Splits a `go run` or `go test` command's arguments, after its verb, into the build flags before the
 * package, the package itself, and what follows it.
 * @param args The arguments after `run` or `test`.
 * @returns Returns the parts; the package is undefined when none is named, which means the folder's own.
 */
function splitPackage(args: readonly string[]): {
  readonly buildFlags: readonly string[];
  readonly target: string | undefined;
  readonly rest: readonly string[];
} {
  const buildFlags: string[] = [];
  let index: number = 0;
  while (index < args.length && args[index].startsWith('-') && args[index] !== '--') {
    const flag: string = args[index];
    buildFlags.push(flag);
    if (!flag.includes('=') && VALUED_BUILD_FLAGS.has(flag) && index + 1 < args.length) {
      buildFlags.push(args[index + 1]);
      index += 1;
    }
    index += 1;
  }
  if (args[index] === '--') {
    return { buildFlags, target: undefined, rest: args.slice(index + 1) };
  }
  return { buildFlags, target: args[index], rest: args.slice(index + 1) };
}

/**
 * Turns a `go test` command's flags after the package into the arguments its test binary reads: each
 * test flag gains the `-test.` prefix, anything else passes through as an argument to the tests.
 * @param flags The flags after the package.
 * @returns Returns the test binary's arguments.
 */
function testBinaryArgs(flags: readonly string[]): readonly string[] {
  const args: string[] = [];
  for (let index: number = 0; index < flags.length; index += 1) {
    const flag: string = flags[index];
    const match: RegExpExecArray | null = /^-{1,2}([a-z]+)(=.*)?$/.exec(flag);
    if (match === null || !TEST_BINARY_FLAGS.has(match[1])) {
      args.push(flag);
      continue;
    }
    args.push(`-test.${match[1]}${match[2] ?? ''}`);
    if (match[2] === undefined && VALUED_TEST_FLAGS.has(match[1]) && index + 1 < flags.length) {
      args.push(flags[index + 1]);
      index += 1;
    }
  }
  return args;
}

/**
 * Resolves a Go run configuration into what Delve launches (#1211). Delve builds the program itself:
 * `go run <package>` launches in Delve's `debug` mode, `go test <package>` in its `test` mode with the
 * test flags spelt as the test binary reads them, and a configuration that names a built program runs
 * it in `exec` mode. Build flags before the package travel as Delve's `buildFlags`. A configuration
 * that names no program debugs the package in its folder.
 * @param configuration The run configuration being launched under the debugger.
 * @param root The absolute workspace root, which the program and its folder must be within.
 * @returns Returns the launch target, or a reason it could not be resolved.
 */
export function goDebugTarget(configuration: RunConfiguration, root: string): DebugResolveResult {
  const cwd: string = path.resolve(root, configuration.cwd ?? '.');
  // The configuration arrives from the renderer, so a hostile one must not debug elsewhere.
  if (!isWithin(cwd, root)) {
    return { target: null, error: 'The configuration runs outside the workspace.' };
  }
  const env: Readonly<Record<string, string>> = configuration.env ?? {};
  const named: string | undefined =
    configuration.program !== undefined && configuration.program.length > 0
      ? configuration.program
      : undefined;
  if (named === undefined) {
    return {
      target: { program: cwd, args: configuration.args, cwd, env, launchExtras: { mode: 'debug' } },
      error: null,
    };
  }
  if (path.basename(named, '.exe') !== 'go') {
    const program: string = path.resolve(cwd, named);
    if (!isWithin(program, root)) {
      return { target: null, error: 'The program to debug must be inside the workspace.' };
    }
    return {
      target: { program, args: configuration.args, cwd, env, launchExtras: { mode: 'exec' } },
      error: null,
    };
  }
  const [verb, ...afterVerb] = configuration.args ?? [];
  if (verb !== 'run' && verb !== 'test') {
    return { target: null, error: 'Only `go run` and `go test` build something to debug.' };
  }
  const { buildFlags, target, rest } = splitPackage(afterVerb);
  const program: string | null = target === undefined ? cwd : packageProgram(target, cwd, root);
  if (program === null) {
    return { target: null, error: 'The package to debug must be inside the workspace.' };
  }
  const flags: Readonly<Record<string, unknown>> =
    buildFlags.length === 0 ? {} : { buildFlags: buildFlags.join(' ') };
  return {
    target: {
      program,
      args: verb === 'test' ? testBinaryArgs(rest) : rest,
      cwd,
      env,
      launchExtras: { mode: verb === 'test' ? 'test' : 'debug', ...flags },
    },
    error: null,
  };
}
