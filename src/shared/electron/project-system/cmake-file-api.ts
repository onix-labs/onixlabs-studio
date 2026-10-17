import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * The CMake File API client name Studio queries under. A client's query lives in its own folder, so
 * Studio's request never disturbs another tool's (an IDE, CMake Tools) in the same build tree.
 */
export const FILE_API_CLIENT: string = 'client-onixlabs-studio';

/**
 * The query Studio asks CMake to answer on every configure: the code model, which names each target
 * and the sources it compiles.
 */
const QUERY: object = { requests: [{ kind: 'codemodel', version: 2 }] };

/**
 * A build target as CMake's code model describes it.
 */
export interface CmakeTarget {
  /**
   * Gets the target's name.
   */
  readonly name: string;

  /**
   * Gets the target's kind, as CMake spells it: `EXECUTABLE`, `STATIC_LIBRARY`, `SHARED_LIBRARY`,
   * `MODULE_LIBRARY`, `OBJECT_LIBRARY`, `INTERFACE_LIBRARY` or `UTILITY`.
   */
  readonly type: string;

  /**
   * Gets the sources the target compiles, relative to the project's top-level source directory,
   * generated sources left out — they live in the build tree and are not the user's to edit.
   */
  readonly sources: readonly string[];
}

/**
 * Gets the folder a client's query file lives in.
 * @param buildDir The build tree.
 * @returns Returns the absolute folder.
 */
function queryFolder(buildDir: string): string {
  return path.join(buildDir, '.cmake', 'api', 'v1', 'query', FILE_API_CLIENT);
}

/**
 * Gets the folder CMake writes its replies to.
 * @param buildDir The build tree.
 * @returns Returns the absolute folder.
 */
function replyFolder(buildDir: string): string {
  return path.join(buildDir, '.cmake', 'api', 'v1', 'reply');
}

/**
 * Asks CMake for the code model on its next configure of a build tree, by writing Studio's query file.
 * Writing is idempotent: the file only names what Studio wants.
 * @param buildDir The build tree.
 * @returns Returns true when the query is in place.
 */
export async function writeCodeModelQuery(buildDir: string): Promise<boolean> {
  try {
    await fs.mkdir(queryFolder(buildDir), { recursive: true });
    await fs.writeFile(path.join(queryFolder(buildDir), 'query.json'), JSON.stringify(QUERY));
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the newest reply index in a build tree, which is the one the latest configure wrote.
 * @param buildDir The build tree.
 * @returns Returns the index file's absolute path, or null when CMake has written none.
 */
export async function latestReplyIndex(buildDir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.readdir(replyFolder(buildDir));
  } catch {
    return null;
  }
  // Index files are named `index-<timestamp>-<hash>.json`, so the newest sorts last.
  const indexes: string[] = names.filter((name: string): boolean => /^index-.*\.json$/.test(name));
  indexes.sort();
  const latest: string | undefined = indexes.at(-1);
  return latest === undefined ? null : path.join(replyFolder(buildDir), latest);
}

/**
 * Reads the code model's file name from a reply index.
 * @param index The parsed index.
 * @returns Returns the code model's reply file name, or null when the index carries none.
 */
export function codeModelFile(index: unknown): string | null {
  const objects: unknown = (index as { objects?: unknown } | null)?.objects;
  if (!Array.isArray(objects)) {
    return null;
  }
  for (const entry of objects as readonly unknown[]) {
    const object: { kind?: unknown; version?: { major?: unknown }; jsonFile?: unknown } =
      entry ?? {};
    if (
      object.kind === 'codemodel' &&
      object.version?.major === 2 &&
      typeof object.jsonFile === 'string'
    ) {
      return object.jsonFile;
    }
  }
  return null;
}

/**
 * Reads the target reply file names from a code model. A single-configuration build has one
 * configuration; a multi-configuration one (Xcode, Visual Studio, Ninja Multi-Config) lists each, and
 * the targets are the same in each, so the first is read.
 * @param codeModel The parsed code model.
 * @returns Returns the target reply file names, in the order CMake lists them.
 */
export function targetFiles(codeModel: unknown): readonly string[] {
  const configurations: unknown = (codeModel as { configurations?: unknown } | null)
    ?.configurations;
  if (!Array.isArray(configurations) || configurations.length === 0) {
    return [];
  }
  const targets: unknown = (configurations[0] as { targets?: unknown } | null)?.targets;
  if (!Array.isArray(targets)) {
    return [];
  }
  return (targets as readonly unknown[])
    .map((entry: unknown): unknown => (entry as { jsonFile?: unknown } | null)?.jsonFile)
    .filter((file: unknown): file is string => typeof file === 'string');
}

/**
 * Reads a target from its reply.
 * @param reply The parsed target reply.
 * @returns Returns the target, or null when the reply is not a target.
 */
export function parseTarget(reply: unknown): CmakeTarget | null {
  const target: { name?: unknown; type?: unknown; sources?: unknown } | null = reply as {
    name?: unknown;
    type?: unknown;
    sources?: unknown;
  } | null;
  if (typeof target?.name !== 'string' || typeof target.type !== 'string') {
    return null;
  }
  const sources: string[] = [];
  for (const entry of Array.isArray(target.sources) ? (target.sources as readonly unknown[]) : []) {
    const source: { path?: unknown; isGenerated?: unknown } | null = entry as {
      path?: unknown;
      isGenerated?: unknown;
    } | null;
    if (typeof source?.path === 'string' && source.isGenerated !== true) {
      sources.push(source.path);
    }
  }
  return { name: target.name, type: target.type, sources };
}

/**
 * Reads every target CMake's latest configure of a build tree described, or null when there is no
 * reply to read (no configure has answered Studio's query yet).
 * @param buildDir The build tree.
 * @returns Returns the targets, or null.
 */
export async function readTargets(buildDir: string): Promise<readonly CmakeTarget[] | null> {
  const index: string | null = await latestReplyIndex(buildDir);
  if (index === null) {
    return null;
  }
  const codeModel: string | null = codeModelFile(await readJson(index));
  if (codeModel === null) {
    return null;
  }
  const targets: CmakeTarget[] = [];
  for (const file of targetFiles(await readJson(path.join(replyFolder(buildDir), codeModel)))) {
    const target: CmakeTarget | null = parseTarget(
      await readJson(path.join(replyFolder(buildDir), file)),
    );
    if (target !== null) {
      targets.push(target);
    }
  }
  return targets;
}

/**
 * Reads and parses a JSON file.
 * @param file The absolute path.
 * @returns Returns the parsed value, or null when it cannot be read or parsed.
 */
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * Reads the `cmake` that configured a build tree, from its cache's `CMAKE_COMMAND`: the most reliable
 * answer, since a GUI-launched app does not inherit the shell's `PATH`.
 * @param cache The `CMakeCache.txt` content.
 * @returns Returns the executable's path, or null when the cache does not name one.
 */
export function cmakeFromCache(cache: string): string | null {
  const match: RegExpExecArray | null = /^CMAKE_COMMAND:INTERNAL=(.+)$/m.exec(cache);
  return match === null ? null : match[1].trim();
}
