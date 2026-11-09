import type { RunConfiguration, RunMode } from '@shared/api/studio';

/**
 * What of a rust-analyzer `Runnable` is read, untrusted.
 */
interface CargoRunnable {
  /**
   * Gets what it runs, as the user reads it.
   */
  readonly label?: unknown;

  /**
   * Gets what kind of runnable it is.
   */
  readonly kind?: unknown;

  /**
   * Gets how it is run.
   */
  readonly args?: {
    readonly cwd?: unknown;
    readonly cargoArgs?: unknown;
    readonly executableArgs?: unknown;
    readonly environment?: unknown;
  };
}

/**
 * Reads what rust-analyzer says to run for a Run lens (#1210) into a run configuration, so it goes
 * through the same terminal, Stop button and problem matching as any other run. `cargo` is always the
 * program: a runnable's `overrideCargo` comes from the server's settings, which a workspace can set
 * through `rust-analyzer.toml`, and a click on Run Tests should not start whatever that names.
 * A Debug lens gives the same runnable, read the same way and marked to be debugged (#1210): the Rust
 * project system builds it without running it, and CodeLLDB launches what was built.
 * @param runnable The lens's argument, untrusted: a rust-analyzer `Runnable`.
 * @param mode Whether it is run, or debugged.
 * @returns Returns the configuration, or null when it is not a Cargo runnable.
 */
export function cargoRunConfiguration(
  runnable: unknown,
  mode: RunMode = 'run',
): RunConfiguration | null {
  const candidate: CargoRunnable | null = typeof runnable === 'object' ? runnable : null;
  const details: CargoRunnable['args'] = candidate?.args;
  if (
    candidate?.kind !== 'cargo' ||
    typeof candidate.label !== 'string' ||
    typeof details?.cwd !== 'string' ||
    !isStrings(details.cargoArgs)
  ) {
    return null;
  }
  const trailing: readonly string[] = isStrings(details.executableArgs)
    ? details.executableArgs
    : [];
  return {
    id: `cargo:${details.cwd}:${candidate.label}`,
    name: candidate.label,
    providerKind: 'rust',
    mode,
    program: 'cargo',
    args: [...details.cargoArgs, ...(trailing.length > 0 ? ['--', ...trailing] : [])],
    cwd: details.cwd,
    env: stringsOf(details.environment),
  };
}

/**
 * Determines whether a value is a list of strings.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isStrings(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry: unknown): boolean => typeof entry === 'string')
  );
}

/**
 * Reads the string entries of an environment, dropping anything else.
 * @param value The environment, untrusted.
 * @returns Returns the entries.
 */
function stringsOf(value: unknown): Readonly<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const [key, entry] of Object.entries(
    typeof value === 'object' && value !== null ? value : {},
  )) {
    if (typeof entry === 'string') {
      entries[key] = entry;
    }
  }
  return entries;
}
