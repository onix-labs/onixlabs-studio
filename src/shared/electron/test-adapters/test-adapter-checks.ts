import * as path from 'node:path';
import {
  TEST_NODE_KINDS,
  TEST_OUTCOMES,
  TestCommand,
  TestDebugLaunch,
  TestDiscovery,
  TestLocation,
  TestNode,
  TestNodeKind,
  TestOutcome,
  TestResult,
  TestRunResults,
  TestStackFrame,
} from '@shared/api/test-adapter-protocol';

// What the test-adapter host checks on the way out of a plugin (#1351). A plugin is code Studio did not
// write, and what it answers reaches the renderer (a tree, links into the editor) or is run (a command,
// a debug launch), so every answer is read as untrusted JSON: bounded, narrowed to the protocol's shape,
// and refused when it would run or link outside the folder it was asked about.

/**
 * The most nodes one discovery may carry. Far above any real solution, and small enough that a plugin
 * cannot flood the renderer.
 */
export const MAX_TEST_NODES: number = 50_000;

/**
 * The deepest a discovered tree may nest.
 */
export const MAX_TEST_DEPTH: number = 16;

/**
 * The most results one run may carry.
 */
export const MAX_TEST_RESULTS: number = 50_000;

/**
 * The most frames one failure's stack may carry.
 */
export const MAX_STACK_FRAMES: number = 200;

/**
 * The longest text a label or identifier may be.
 */
const MAX_LABEL_LENGTH: number = 2_000;

/**
 * The longest a failure message may be.
 */
const MAX_MESSAGE_LENGTH: number = 64 * 1024;

/**
 * The longest one test's captured output may be.
 */
const MAX_TEST_OUTPUT_LENGTH: number = 256 * 1024;

/**
 * The longest a run's transcript may be when it is handed to a plugin: its last megabyte.
 */
export const MAX_RUN_TRANSCRIPT_LENGTH: number = 1024 * 1024;

/**
 * Matches an environment variable's name.
 */
const ENV_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Matches a debug adapter's identifier, as plugin identifiers are written.
 */
const ADAPTER_ID: RegExp = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * The launch keys Studio writes itself, which a plugin's adapter-specific configuration may not set.
 */
const RESERVED_LAUNCH_KEYS: ReadonlySet<string> = new Set<string>([
  'request',
  'name',
  'type',
  'program',
  'args',
  'cwd',
  'env',
  'console',
  'noDebug',
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Determines whether a path lies within a folder.
 * @param target The candidate path.
 * @param root The absolute, resolved folder.
 * @returns Returns true when it is an absolute path inside the folder, or the folder itself.
 */
export function isInside(target: unknown, root: string): boolean {
  if (typeof target !== 'string' || target.includes('\0') || !path.isAbsolute(target)) {
    return false;
  }
  const resolved: string = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Reads a record from an untrusted value.
 * @param value The candidate.
 * @returns Returns the record, or null when it is not one.
 */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads a short, non-empty text.
 * @param value The candidate.
 * @returns Returns the text, cut to {@link MAX_LABEL_LENGTH}, or null when it is not a non-empty string.
 */
function label(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    ? value.slice(0, MAX_LABEL_LENGTH)
    : null;
}

/**
 * Reads an optional text, cut to a length.
 * @param value The candidate.
 * @param max The longest it may be.
 * @returns Returns the text, or undefined when absent or not a string.
 */
function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

/**
 * Reads a location, keeping it only when it points inside the folder: a link out of it would open a
 * file the user did not open.
 * @param value The candidate.
 * @param root The folder.
 * @returns Returns the location, or undefined when it is malformed or outside the folder.
 */
export function checkLocation(value: unknown, root: string): TestLocation | undefined {
  const source: Record<string, unknown> | null = record(value);
  if (source === null || !isInside(source['file'], root)) {
    return undefined;
  }
  const line: unknown = source['line'];
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    return undefined;
  }
  return { file: path.resolve(source['file'] as string), line };
}

/**
 * Checks a discovery: the shape, the kinds, unique identifiers, the bounds, and locations inside the
 * folder. A malformed node is dropped with everything under it rather than refusing the whole answer,
 * so one bad file does not hide a solution's tests.
 * @param value The plugin's answer.
 * @param root The folder.
 * @returns Returns the discovery, or null when it is not one.
 */
export function checkDiscovery(value: unknown, root: string): TestDiscovery | null {
  const source: Record<string, unknown> | null = record(value);
  if (source === null || !Array.isArray(source['tests'])) {
    return null;
  }
  const seen: Set<string> = new Set<string>();
  let budget: number = MAX_TEST_NODES;
  const read: (candidate: unknown, depth: number) => TestNode | null = (
    candidate: unknown,
    depth: number,
  ): TestNode | null => {
    const node: Record<string, unknown> | null = record(candidate);
    if (node === null || budget <= 0 || depth > MAX_TEST_DEPTH) {
      return null;
    }
    const id: string | null = label(node['id']);
    const text: string | null = label(node['label']);
    const kind: unknown = node['kind'];
    if (
      id === null ||
      text === null ||
      seen.has(id) ||
      !(TEST_NODE_KINDS as readonly unknown[]).includes(kind)
    ) {
      return null;
    }
    seen.add(id);
    budget -= 1;
    const framework: string | undefined = optionalText(node['framework'], 64);
    const location: TestLocation | undefined = checkLocation(node['location'], root);
    const children: readonly TestNode[] | undefined = Array.isArray(node['children'])
      ? node['children']
          .map((child: unknown): TestNode | null => read(child, depth + 1))
          .filter((child: TestNode | null): child is TestNode => child !== null)
      : undefined;
    return {
      id,
      label: text,
      kind: kind as TestNodeKind,
      ...(framework === undefined ? {} : { framework }),
      ...(location === undefined ? {} : { location }),
      ...(children === undefined ? {} : { children }),
    };
  };
  const tests: readonly TestNode[] = source['tests']
    .map((candidate: unknown): TestNode | null => read(candidate, 0))
    .filter((node: TestNode | null): node is TestNode => node !== null);
  return { tests };
}

/**
 * Checks an environment a plugin wants set: variable names only, string values, no NUL.
 * @param value The candidate.
 * @returns Returns the environment, undefined when there is none, or null when it is malformed.
 */
function checkEnvironment(value: unknown): Readonly<Record<string, string>> | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  const source: Record<string, unknown> | null = record(value);
  if (source === null) {
    return null;
  }
  const env: Record<string, string> = {};
  for (const [name, entry] of Object.entries(source)) {
    if (!ENV_NAME.test(name) || typeof entry !== 'string' || entry.includes('\0')) {
      return null;
    }
    env[name] = entry;
  }
  return env;
}

/**
 * Checks arguments: an array of strings without NUL.
 * @param value The candidate.
 * @returns Returns the arguments, or null when they are malformed.
 */
function checkArguments(value: unknown): readonly string[] | null {
  return Array.isArray(value) &&
    value.every((arg: unknown): boolean => typeof arg === 'string' && !arg.includes('\0'))
    ? (value as readonly string[])
    : null;
}

/**
 * Checks a command a plugin answered a run with. ⛔ Studio runs what comes back in a terminal, so a
 * malformed one, or one that would run outside the folder the request named, goes no further.
 * @param value The plugin's answer.
 * @param root The folder.
 * @returns Returns the command, or null when it may not run.
 */
export function checkCommand(value: unknown, root: string): TestCommand | null {
  const source: Record<string, unknown> | null = record(value);
  if (source === null) {
    return null;
  }
  const executable: string | null = label(source['executable']);
  const title: string | null = label(source['title']);
  const args: readonly string[] | null = checkArguments(source['args']);
  const env: Readonly<Record<string, string>> | undefined | null = checkEnvironment(source['env']);
  if (
    executable === null ||
    title === null ||
    args === null ||
    env === null ||
    !isInside(source['cwd'], root)
  ) {
    return null;
  }
  return {
    executable,
    args,
    cwd: path.resolve(source['cwd'] as string),
    title: title.slice(0, 200),
    ...(env === undefined ? {} : { env }),
  };
}

/**
 * Checks a debug launch a plugin answered with. ⛔ Studio starts it, so the same rules as a command
 * apply, and the adapter-specific keys may neither shadow the keys Studio writes nor carry anything but
 * plain values.
 * @param value The plugin's answer.
 * @param root The folder.
 * @returns Returns the launch, or null when it may not start.
 */
export function checkDebugLaunch(value: unknown, root: string): TestDebugLaunch | null {
  const source: Record<string, unknown> | null = record(value);
  if (source === null) {
    return null;
  }
  const adapter: unknown = source['adapter'];
  const title: string | null = label(source['title']);
  const program: string | null = label(source['program']);
  const args: readonly string[] | null = checkArguments(source['args']);
  const env: Readonly<Record<string, string>> | undefined | null = checkEnvironment(source['env']);
  if (
    typeof adapter !== 'string' ||
    !ADAPTER_ID.test(adapter) ||
    title === null ||
    program === null ||
    args === null ||
    env === null ||
    !isInside(source['cwd'], root)
  ) {
    return null;
  }
  let configuration: Record<string, string | boolean | number> | undefined;
  if (source['configuration'] !== undefined) {
    const extras: Record<string, unknown> | null = record(source['configuration']);
    if (extras === null) {
      return null;
    }
    configuration = {};
    for (const [key, entry] of Object.entries(extras)) {
      if (
        RESERVED_LAUNCH_KEYS.has(key) ||
        !['string', 'boolean', 'number'].includes(typeof entry)
      ) {
        return null;
      }
      configuration[key] = entry as string | boolean | number;
    }
  }
  return {
    adapter,
    title: title.slice(0, 200),
    program,
    args,
    cwd: path.resolve(source['cwd'] as string),
    ...(env === undefined ? {} : { env }),
    ...(configuration === undefined ? {} : { configuration }),
  };
}

/**
 * Checks a stack frame, keeping its link only when it points inside the folder.
 * @param value The candidate.
 * @param root The folder.
 * @returns Returns the frame, or null when it is malformed.
 */
function checkFrame(value: unknown, root: string): TestStackFrame | null {
  const source: Record<string, unknown> | null = record(value);
  const text: string | null = label(source?.['text']);
  if (source === null || text === null) {
    return null;
  }
  const location: TestLocation | undefined = checkLocation(source['location'], root);
  return { text, ...(location === undefined ? {} : { location }) };
}

/**
 * Checks a run's results: the shape, the outcomes, the bounds, and links inside the folder.
 * @param value The plugin's answer.
 * @param root The folder.
 * @returns Returns the results, or null when they are not results.
 */
export function checkResults(value: unknown, root: string): TestRunResults | null {
  const source: Record<string, unknown> | null = record(value);
  if (source === null || !Array.isArray(source['results'])) {
    return null;
  }
  const results: TestResult[] = [];
  for (const candidate of source['results'].slice(0, MAX_TEST_RESULTS)) {
    const result: Record<string, unknown> | null = record(candidate);
    const id: string | null = label(result?.['id']);
    const outcome: unknown = result?.['outcome'];
    if (
      result === null ||
      id === null ||
      !(TEST_OUTCOMES as readonly unknown[]).includes(outcome)
    ) {
      continue;
    }
    const duration: unknown = result['durationMs'];
    const message: string | undefined = optionalText(result['message'], MAX_MESSAGE_LENGTH);
    const output: string | undefined = optionalText(result['output'], MAX_TEST_OUTPUT_LENGTH);
    const parentId: string | null = label(result['parentId']);
    const text: string | null = label(result['label']);
    const location: TestLocation | undefined = checkLocation(result['location'], root);
    const stack: readonly TestStackFrame[] | undefined = Array.isArray(result['stack'])
      ? result['stack']
          .slice(0, MAX_STACK_FRAMES)
          .map((frame: unknown): TestStackFrame | null => checkFrame(frame, root))
          .filter((frame: TestStackFrame | null): frame is TestStackFrame => frame !== null)
      : undefined;
    results.push({
      id,
      outcome: outcome as TestOutcome,
      ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
        ? { durationMs: duration }
        : {}),
      ...(message === undefined ? {} : { message }),
      ...(stack === undefined || stack.length === 0 ? {} : { stack }),
      ...(output === undefined ? {} : { output }),
      ...(parentId === null ? {} : { parentId }),
      ...(text === null ? {} : { label: text }),
      ...(location === undefined ? {} : { location }),
    });
  }
  const problem: string | undefined = optionalText(source['problem'], MAX_MESSAGE_LENGTH);
  return { results, ...(problem === undefined ? {} : { problem }) };
}

/**
 * Cuts a run's transcript to what a plugin is handed: colour and cursor codes removed, and its last
 * {@link MAX_RUN_TRANSCRIPT_LENGTH} characters, since a failure summary is printed last.
 * @param value The transcript, untrusted.
 * @returns Returns the text to hand over.
 */
export function cutTranscript(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  // CSI sequences (colour, cursor movement) and OSC sequences (titles, links), then lone escapes.
  const plain: string = value.replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b./g,
    '',
  );
  return plain.length > MAX_RUN_TRANSCRIPT_LENGTH
    ? plain.slice(plain.length - MAX_RUN_TRANSCRIPT_LENGTH)
    : plain;
}
