import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GitIdentity,
  SetupProbeId,
  SetupProbeResult,
  SetupProbeStatus,
} from '@shared/api/setup-channels';
import { logger } from '../logger';

/**
 * Promisified `execFile`, which is used throughout rather than a shell: every command here is a fixed
 * binary name with a fixed argument list, and running them through a shell would add quoting and
 * interpolation the probes have no use for.
 */
const run: (
  file: string,
  args: readonly string[],
  options: { timeout: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Holds how long a single probe may take before it is reported as unknown.
 *
 * A probe spawns a process, and a process can hang — a network mount, a shell profile waiting on
 * something. The step must not. Every probe is bounded, and the whole set runs concurrently, so the
 * step takes as long as its slowest answer rather than the sum of them.
 */
const PROBE_TIMEOUT_MS: number = 5000;

/**
 * Describes how one probe is run: the binary, the arguments that make it report its version, and how
 * its absence should be reported.
 */
interface ProbeDefinition {
  /**
   * Gets the executable to run. A fixed name, resolved against PATH — never a value from the
   * renderer.
   */
  readonly binary: string;

  /**
   * Gets the arguments that make it print its version.
   */
  readonly args: readonly string[];

  /**
   * Gets the message shown when it is not installed, which names what stops working without it.
   */
  readonly missing: string;
}

/**
 * Holds the probes the main process is willing to run, keyed by the identifier the renderer asks for.
 *
 * This map IS the allowlist. The renderer names a key; nothing it sends reaches `execFile`.
 */
const PROBES: Readonly<Record<Exclude<SetupProbeId, 'git-identity'>, ProbeDefinition>> = {
  git: {
    binary: 'git',
    args: ['--version'],
    missing: 'Source control is unavailable without it.',
  },
  dotnet: {
    binary: 'dotnet',
    args: ['--version'],
    missing: 'The C# language server and .NET projects need it.',
  },
  java: {
    binary: 'java',
    args: ['-version'],
    missing: 'The Java and Kotlin language servers need it.',
  },
  node: {
    binary: 'node',
    args: ['--version'],
    missing: 'TypeScript and JavaScript tooling needs it.',
  },
  clangd: {
    binary: 'clangd',
    args: ['--version'],
    missing: 'The C and C++ language server needs it.',
  },
};

/**
 * Runs every environment probe concurrently and reports what it found.
 *
 * The results are not cached. This deliberately differs from the language-server provisioner's
 * executable detection, which caches per session and is right to: it answers "can I start this
 * server", asked repeatedly, where the answer does not change mid-session. The health step answers
 * "is this machine set up", asked by a user who is about to go and fix whatever it says — so a cached
 * answer would survive the fix and tell them their work did nothing.
 * @param environment The environment to run the probes in, which should be the user's login-shell
 * environment rather than the one Studio was launched with — the whole point is to see the PATH the
 * user sees.
 * @returns Returns one result per probe.
 */
export async function runSetupProbes(
  environment: NodeJS.ProcessEnv,
): Promise<readonly SetupProbeResult[]> {
  const executables: readonly SetupProbeId[] = Object.keys(PROBES) as readonly SetupProbeId[];
  const results: readonly SetupProbeResult[] = await Promise.all([
    ...executables.map((id: SetupProbeId): Promise<SetupProbeResult> =>
      probeExecutable(id, environment),
    ),
    probeGitIdentity(environment),
  ]);
  logger.info(
    'SetupProbes',
    `Probed ${results.length} item(s): ${results
      .filter((result: SetupProbeResult): boolean => result.status !== 'ok')
      .map((result: SetupProbeResult): string => `${result.id}=${result.status}`)
      .join(', ')}`,
  );
  return results;
}

/**
 * Runs one executable probe.
 * @param id The probe identifier.
 * @param environment The environment to run it in.
 * @returns Returns the result.
 */
async function probeExecutable(
  id: SetupProbeId,
  environment: NodeJS.ProcessEnv,
): Promise<SetupProbeResult> {
  const definition: ProbeDefinition = PROBES[id as Exclude<SetupProbeId, 'git-identity'>];
  try {
    const { stdout, stderr }: { stdout: string; stderr: string } = await run(
      definition.binary,
      definition.args,
      { timeout: PROBE_TIMEOUT_MS, env: environment },
    );
    // Some tools (java) print their version on stderr, which is not an error here.
    return { id, status: 'ok', detail: firstLine(stdout.length > 0 ? stdout : stderr) };
  } catch (error: unknown) {
    return {
      id,
      status: timedOut(error) ? 'unknown' : 'missing',
      detail: timedOut(error)
        ? 'Took too long to answer, so this could not be checked.'
        : `Not found on your PATH. ${definition.missing}`,
    };
  }
}

/**
 * Reports whether git is configured to attribute commits to anybody.
 *
 * Separate from whether git exists, because the two fail differently: a missing git is obvious
 * immediately, whereas a missing identity is invisible until the first commit is refused — often
 * hours into a session, with an error that names a config key rather than a thing to do.
 * @param environment The environment to run git in.
 * @returns Returns the result.
 */
async function probeGitIdentity(environment: NodeJS.ProcessEnv): Promise<SetupProbeResult> {
  const identity: GitIdentity | null = await readGitIdentity(environment);
  if (identity === null) {
    return {
      id: 'git-identity',
      status: 'unknown',
      detail: 'Could not be read, because git is not available.',
    };
  }
  const missing: readonly string[] = [
    ...(identity.name.length === 0 ? ['name'] : []),
    ...(identity.email.length === 0 ? ['email'] : []),
  ];
  const status: SetupProbeStatus = missing.length === 0 ? 'ok' : 'warn';
  return {
    id: 'git-identity',
    status,
    detail:
      status === 'ok'
        ? `${identity.name} <${identity.email}>`
        : `No ${missing.join(' or ')} configured, so commits will be refused.`,
  };
}

/**
 * Reads the globally configured git identity.
 * @param environment The environment to run git in.
 * @returns Returns the identity, or null when git could not be run at all.
 */
export async function readGitIdentity(environment: NodeJS.ProcessEnv): Promise<GitIdentity | null> {
  const [name, email]: readonly (string | null)[] = await Promise.all([
    gitConfig('user.name', environment),
    gitConfig('user.email', environment),
  ]);
  // An unset key and an absent git are both failures of the same command, so they are told apart by
  // whether BOTH reads failed outright — git itself missing — rather than by exit code alone.
  if (name === null && email === null && !(await gitAvailable(environment))) {
    return null;
  }
  return { name: name ?? '', email: email ?? '' };
}

/**
 * Writes the globally configured git identity, skipping either field the caller left empty.
 * @param identity The identity to write.
 * @param environment The environment to run git in.
 * @returns Returns the identity git holds afterwards, or null when git could not be run.
 */
export async function writeGitIdentity(
  identity: GitIdentity,
  environment: NodeJS.ProcessEnv,
): Promise<GitIdentity | null> {
  for (const [key, value] of [
    ['user.name', identity.name],
    ['user.email', identity.email],
  ] as const) {
    if (value.length === 0) {
      continue;
    }
    try {
      // The value is user-entered, and it is passed as an argument rather than interpolated into a
      // command line — there is no shell here, so it cannot be anything but a value.
      await run('git', ['config', '--global', key, value], {
        timeout: PROBE_TIMEOUT_MS,
        env: environment,
      });
    } catch (error: unknown) {
      logger.warn('SetupProbes', `Could not set git ${key}`, error);
      return null;
    }
  }
  return readGitIdentity(environment);
}

/**
 * Reads one global git configuration value.
 * @param key The configuration key.
 * @param environment The environment to run git in.
 * @returns Returns the value, or null when it is unset or git could not be run.
 */
async function gitConfig(key: string, environment: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout }: { stdout: string } = await run('git', ['config', '--global', '--get', key], {
      timeout: PROBE_TIMEOUT_MS,
      env: environment,
    });
    const value: string = stdout.trim();
    return value.length === 0 ? null : value;
  } catch {
    // `git config --get` exits non-zero for an unset key, which is an answer rather than a failure.
    return null;
  }
}

/**
 * Determines whether git can be run at all.
 * @param environment The environment to run git in.
 * @returns Returns true when git answered.
 */
async function gitAvailable(environment: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await run('git', ['--version'], { timeout: PROBE_TIMEOUT_MS, env: environment });
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines whether a failure was the probe's timeout rather than the tool's absence.
 * @param error The failure.
 * @returns Returns true when the process was killed for taking too long.
 */
function timedOut(error: unknown): boolean {
  return (error as { killed?: boolean } | null)?.killed === true;
}

/**
 * Reduces a tool's version output to its first line, which is the part worth showing.
 * @param output The tool's output.
 * @returns Returns the first non-empty line, trimmed.
 */
function firstLine(output: string): string {
  return output.split('\n')[0]?.trim() ?? '';
}
