import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SetupProbeId, SetupProbeResult } from '@shared/api/setup-channels';
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
export const PROBE_TIMEOUT_MS: number = 5000;

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
const PROBES: Readonly<Record<Exclude<SetupProbeId, 'git' | 'git-identity'>, ProbeDefinition>> = {
  node: {
    binary: 'node',
    args: ['--version'],
    missing: 'TypeScript and JavaScript language support needs it.',
  },
  dotnet: {
    binary: 'dotnet',
    args: ['--version'],
    missing: 'C# language support and .NET projects need it.',
  },
  java: {
    binary: 'java',
    args: ['-version'],
    missing: 'Java and Kotlin language support need it.',
  },
  go: {
    binary: 'go',
    args: ['version'],
    missing: 'Go language support needs it.',
  },
  // Cargo rather than rustc: it is what rust-analyzer drives, and a Rust toolchain that has one has
  // the other.
  rust: {
    binary: 'cargo',
    args: ['--version'],
    missing: 'Rust language support needs it.',
  },
  python: {
    binary: 'python3',
    args: ['--version'],
    missing: 'Python debugging needs it.',
  },
  clangd: {
    binary: 'clangd',
    args: ['--version'],
    missing: 'C and C++ language support needs it.',
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
  const definition: ProbeDefinition = PROBES[id as Exclude<SetupProbeId, 'git' | 'git-identity'>];
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
