import * as path from 'node:path';

/**
 * The arguments that ask Cargo what a crate is made of. `--no-deps` reads the workspace's own manifests
 * and stops: nothing is resolved, so nothing is downloaded, no `Cargo.lock` is written, and no build
 * script runs.
 * @param manifestPath The absolute path of the crate's `Cargo.toml`.
 * @returns Returns the arguments.
 */
export function cargoMetadataArguments(manifestPath: string): readonly string[] {
  return [
    'metadata',
    '--no-deps',
    '--offline',
    '--format-version',
    '1',
    '--manifest-path',
    manifestPath,
  ];
}

/**
 * Reads the source file of each of a crate's targets (its library, binaries, tests, examples, benches
 * and build script) out of `cargo metadata`'s output, which describes the whole workspace.
 * @param output The output.
 * @param manifestPath The absolute path of the crate's `Cargo.toml`, as Cargo spells it.
 * @returns Returns the absolute paths, or null when the output does not describe the crate.
 */
export function parseCargoTargetSources(
  output: string,
  manifestPath: string,
): readonly string[] | null {
  let metadata: { packages?: unknown } | null;
  try {
    metadata = JSON.parse(output) as { packages?: unknown } | null;
  } catch {
    return null;
  }
  const packages: unknown = metadata?.packages;
  if (!Array.isArray(packages)) {
    return null;
  }
  for (const entry of packages as readonly unknown[]) {
    const crate: { manifest_path?: unknown; targets?: unknown } | null = entry as {
      manifest_path?: unknown;
      targets?: unknown;
    } | null;
    if (crate?.manifest_path === manifestPath && Array.isArray(crate.targets)) {
      return (crate.targets as readonly unknown[])
        .map((target: unknown): unknown => (target as { src_path?: unknown } | null)?.src_path)
        .filter((source: unknown): source is string => typeof source === 'string');
    }
  }
  return null;
}

/**
 * Finds the directories a crate's sources live under: each target's directory, which holds the modules
 * its root file pulls in. A target sitting in the crate's own directory (a `build.rs`) contributes no
 * directory, or the crate's whole folder would be listed, and neither does one outside the crate.
 * Directories inside another are dropped, so `src/bin` is covered by `src`.
 * @param crateDirectory The crate's directory.
 * @param sources The absolute paths of its targets' source files.
 * @returns Returns the absolute directories.
 */
export function crateSourceDirectories(
  crateDirectory: string,
  sources: readonly string[],
): readonly string[] {
  const inside: string[] = sources
    .map((source: string): string => path.dirname(source))
    .filter((directory: string): boolean => {
      const relative: string = path.relative(crateDirectory, directory);
      return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  return [...new Set<string>(inside)]
    .sort()
    .filter(
      (directory: string, _index: number, all: readonly string[]): boolean =>
        !all.some((other: string): boolean => directory.startsWith(`${other}${path.sep}`)),
    );
}
