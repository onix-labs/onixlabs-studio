// Reads what is installed: the version each package resolved to, from the lockfile the project's tool
// keeps (`uv.lock`, `poetry.lock`, `Pipfile.lock`) or, where there is none, from the project's virtual
// environment. Files only: ⛔ Python is never run to ask, since running a project's interpreter runs
// whatever its `site-packages` start up with.
//
// Every map is keyed by the PEP 503 normalised name, because a lockfile, a manifest and a
// `.dist-info` folder each spell a name their own way.

import { Dirent, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { normaliseName } from './requirements';
import { asArray, asString, asTable, parseToml, TomlTable } from './toml';

/**
 * The virtual-environment folders looked for in a project, in the order they are preferred.
 */
export const VENV_DIRECTORIES: readonly string[] = ['.venv', 'venv'];

/**
 * Reads the `[[package]]` entries of a lockfile in the shape uv and Poetry share: a `name` and a
 * `version` each.
 * @param text The lockfile's text.
 * @returns Returns the versions by normalised name; empty when it cannot be read.
 */
export function readTomlLock(text: string): ReadonlyMap<string, string> {
  const toml: TomlTable | null = parseToml(text);
  const versions: Map<string, string> = new Map<string, string>();
  for (const entry of asArray(toml?.['package'])) {
    const table: TomlTable | null = asTable(entry);
    const name: string | null = asString(table?.['name']);
    const version: string | null = asString(table?.['version']);
    if (name !== null && version !== null && !versions.has(normaliseName(name))) {
      versions.set(normaliseName(name), version);
    }
  }
  return versions;
}

/**
 * Reads a `Pipfile.lock`: JSON, whose `default` and `develop` sections pin each package with
 * `"version": "==2.31.0"`.
 * @param text The lockfile's text.
 * @returns Returns the versions by normalised name; empty when it cannot be read.
 */
export function readPipfileLock(text: string): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return versions;
  }
  for (const section of ['default', 'develop']) {
    const entries: unknown = (parsed as Record<string, unknown> | null)?.[section];
    if (typeof entries !== 'object' || entries === null) {
      continue;
    }
    for (const [name, entry] of Object.entries(entries as Record<string, unknown>)) {
      const version: unknown = (entry as Record<string, unknown> | null)?.['version'];
      if (
        typeof version === 'string' &&
        version.startsWith('==') &&
        !versions.has(normaliseName(name))
      ) {
        versions.set(normaliseName(name), version.slice(2));
      }
    }
  }
  return versions;
}

/**
 * Reads what a virtual environment has installed, from the names of the `.dist-info` folders in its
 * `site-packages`: `requests-2.31.0.dist-info` is requests 2.31.0.
 * @param venv The absolute path of the environment.
 * @returns Returns the versions by normalised name; empty when it holds none or cannot be read.
 */
export async function readVirtualEnvironment(venv: string): Promise<ReadonlyMap<string, string>> {
  const versions: Map<string, string> = new Map<string, string>();
  for (const sitePackages of await sitePackagesOf(venv)) {
    for (const entry of await list(sitePackages)) {
      const match: RegExpExecArray | null = /^(.+)-([^-]+)\.dist-info$/.exec(entry.name);
      if (entry.isDirectory() && match !== null && !versions.has(normaliseName(match[1]))) {
        versions.set(normaliseName(match[1]), match[2]);
      }
    }
  }
  return versions;
}

/**
 * Finds a project's virtual environment: one of {@link VENV_DIRECTORIES} that holds a `pyvenv.cfg`,
 * which every environment `venv`, virtualenv and uv make does.
 * @param directory The absolute folder to look in.
 * @returns Returns the environment's absolute path, or null when there is none.
 */
export async function findVirtualEnvironment(directory: string): Promise<string | null> {
  for (const name of VENV_DIRECTORIES) {
    const venv: string = path.join(directory, name);
    try {
      await fs.access(path.join(venv, 'pyvenv.cfg'));
      return venv;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/**
 * Finds an environment's `site-packages` folders: `lib/python3.x/site-packages` (and `lib64`) on
 * macOS and Linux, `Lib/site-packages` on Windows.
 * @param venv The absolute path of the environment.
 * @returns Returns the folders that exist.
 */
async function sitePackagesOf(venv: string): Promise<readonly string[]> {
  const folders: string[] = [];
  for (const lib of ['lib', 'lib64']) {
    for (const entry of await list(path.join(venv, lib))) {
      if (entry.isDirectory() && /^python\d/.test(entry.name)) {
        folders.push(path.join(venv, lib, entry.name, 'site-packages'));
      }
    }
  }
  folders.push(path.join(venv, 'Lib', 'site-packages'));
  return folders;
}

/**
 * Lists a folder, or nothing when it cannot be read.
 * @param directory The folder.
 * @returns Returns its entries.
 */
async function list(directory: string): Promise<readonly Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
