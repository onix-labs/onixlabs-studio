// The crates a folder holds, read from their `Cargo.toml` files (#1356).
//
// Only what finding and naming tests needs: a package's name, its library's name, whether a manifest is
// a workspace root, and the targets cargo infers from the standard layout. Not a TOML parser: section
// headers and `name = "…"` keys, which is all of that.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { walkFiles } from '../../protocol/testing/source';

/**
 * Names a test target the way cargo's `--lib`, `--bin` and `--test` flags do.
 */
export type CargoTarget =
  | { readonly kind: 'lib' }
  | { readonly kind: 'bin'; readonly name: string }
  | { readonly kind: 'test'; readonly name: string };

/**
 * Describes a target and the file it starts from.
 */
export interface CargoTargetRoot {
  /**
   * Gets the target.
   */
  readonly target: CargoTarget;

  /**
   * Gets the absolute path of its root source file.
   */
  readonly file: string;
}

/**
 * Describes one crate.
 */
export interface Crate {
  /**
   * Gets the package name.
   */
  readonly name: string;

  /**
   * Gets the library's crate name: the `[lib]` name, else the package name with dashes as underscores.
   * Cargo names the library's test binary after it.
   */
  readonly libName: string;

  /**
   * Gets the absolute path of its `Cargo.toml`.
   */
  readonly manifest: string;

  /**
   * Gets the absolute path of the folder it is in.
   */
  readonly directory: string;

  /**
   * Gets the manifest of the workspace it belongs to, or undefined when it is its own.
   */
  readonly workspace?: string;

  /**
   * Gets its test targets, as cargo infers them from the standard layout.
   */
  readonly targets: readonly CargoTargetRoot[];
}

/**
 * Describes what a manifest says, before its targets are found.
 */
export interface ManifestFacts {
  /**
   * Gets the `[package]` name, or undefined for a manifest with no package (a virtual workspace).
   */
  readonly packageName?: string;

  /**
   * Gets the `[lib]` name, when one is set.
   */
  readonly libName?: string;

  /**
   * Gets whether the manifest has a `[workspace]` section.
   */
  readonly workspace: boolean;
}

/**
 * Reads the facts a manifest's text states.
 * @param text The manifest's text.
 * @returns Returns the facts.
 */
export function readManifest(text: string): ManifestFacts {
  let section: string = '';
  let packageName: string | undefined;
  let libName: string | undefined;
  let workspace: boolean = false;
  for (const raw of text.split(/\r?\n/)) {
    const line: string = raw.replace(/#.*$/, '').trim();
    const header: RegExpExecArray | null = /^\[\[?\s*([^\]\s]+)\s*\]\]?$/.exec(line);
    if (header !== null) {
      section = header[1];
      if (section === 'workspace') {
        workspace = true;
      }
      continue;
    }
    const name: RegExpExecArray | null = /^name\s*=\s*["']([^"']+)["']/.exec(line);
    if (name !== null) {
      if (section === 'package') {
        packageName = name[1];
      } else if (section === 'lib') {
        libName = name[1];
      }
    }
  }
  return {
    ...(packageName === undefined ? {} : { packageName }),
    ...(libName === undefined ? {} : { libName }),
    workspace,
  };
}

/**
 * Determines whether a file exists.
 * @param file The path.
 * @returns Returns true when it is a file.
 */
async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Lists the `.rs` files directly in a folder.
 * @param directory The folder.
 * @returns Returns their names.
 */
async function rustFiles(directory: string): Promise<readonly string[]> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Finds a crate's targets in the standard layout: `src/lib.rs`, `src/main.rs`, `src/bin/*.rs`,
 * `tests/*.rs` and `tests/<name>/main.rs`.
 * @param directory The crate's folder.
 * @param packageName The package name, which names the `src/main.rs` binary.
 * @returns Returns the targets.
 */
export async function findTargets(
  directory: string,
  packageName: string,
): Promise<readonly CargoTargetRoot[]> {
  const targets: CargoTargetRoot[] = [];
  const lib: string = path.join(directory, 'src', 'lib.rs');
  if (await isFile(lib)) {
    targets.push({ target: { kind: 'lib' }, file: lib });
  }
  const main: string = path.join(directory, 'src', 'main.rs');
  if (await isFile(main)) {
    targets.push({ target: { kind: 'bin', name: packageName }, file: main });
  }
  for (const name of await rustFiles(path.join(directory, 'src', 'bin'))) {
    targets.push({
      target: { kind: 'bin', name: name.slice(0, -3) },
      file: path.join(directory, 'src', 'bin', name),
    });
  }
  const tests: string = path.join(directory, 'tests');
  for (const name of await rustFiles(tests)) {
    targets.push({
      target: { kind: 'test', name: name.slice(0, -3) },
      file: path.join(tests, name),
    });
  }
  try {
    for (const entry of await fs.readdir(tests, { withFileTypes: true })) {
      const main: string = path.join(tests, entry.name, 'main.rs');
      if (entry.isDirectory() && (await isFile(main))) {
        targets.push({ target: { kind: 'test', name: entry.name }, file: main });
      }
    }
  } catch {
    // No tests folder.
  }
  return targets;
}

/**
 * Finds every crate in a folder, and the workspace each belongs to: the nearest manifest above it with
 * a `[workspace]` section, which is where cargo looks.
 * @param root The absolute folder.
 * @returns Returns the crates, by manifest path.
 */
export async function findCrates(root: string): Promise<readonly Crate[]> {
  const manifests: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => name === 'Cargo.toml',
  });
  const facts: Map<string, ManifestFacts> = new Map<string, ManifestFacts>();
  for (const manifest of manifests) {
    try {
      facts.set(manifest, readManifest(await fs.readFile(manifest, 'utf8')));
    } catch {
      // Unreadable: not a crate Studio can list.
    }
  }
  const workspaces: readonly string[] = [...facts]
    .filter(([, fact]) => fact.workspace)
    .map(([manifest]) => manifest);
  const crates: Crate[] = [];
  for (const [manifest, fact] of facts) {
    if (fact.packageName === undefined) {
      continue;
    }
    const directory: string = path.dirname(manifest);
    const workspace: string | undefined = workspaces
      .filter((candidate: string): boolean => {
        const top: string = path.dirname(candidate);
        return directory === top || directory.startsWith(top + path.sep);
      })
      .sort((a: string, b: string): number => b.length - a.length)[0];
    crates.push({
      name: fact.packageName,
      libName: fact.libName ?? fact.packageName.replace(/-/g, '_'),
      manifest,
      directory,
      ...(workspace === undefined || workspace === manifest ? {} : { workspace }),
      targets: await findTargets(directory, fact.packageName),
    });
  }
  return crates;
}

/**
 * Names a target as an identifier segment: `lib`, `bin:<name>` or `test:<name>`.
 * @param target The target.
 * @returns Returns the segment.
 */
export function targetKey(target: CargoTarget): string {
  return target.kind === 'lib' ? 'lib' : `${target.kind}:${target.name}`;
}

/**
 * Reads a target back from its identifier segment.
 * @param key The segment.
 * @returns Returns the target, or null when it is not one.
 */
export function parseTargetKey(key: string): CargoTarget | null {
  if (key === 'lib') {
    return { kind: 'lib' };
  }
  const match: RegExpExecArray | null = /^(bin|test):(.+)$/.exec(key);
  return match === null ? null : { kind: match[1] as 'bin' | 'test', name: match[2] };
}
