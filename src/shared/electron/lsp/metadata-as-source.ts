import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/**
 * The folder, under the system temporary directory, where the Roslyn C# server writes the decompiled
 * source it answers Go to Definition with for a symbol in the framework or a NuGet package — for
 * example `<tmp>/MetadataAsSource/<hash>/DecompilationMetadataAsSourceFileProvider/<hash>/IList.cs`.
 * The server inherits Studio's environment, so its temporary directory is Studio's.
 */
const METADATA_AS_SOURCE_FOLDER: string = 'MetadataAsSource';

/**
 * Decides whether a path is a language server's decompiled source: a file whose **real** path lies
 * inside `<tmp>/MetadataAsSource/`. These are the one kind of file outside every workspace the editor
 * may open, and only to read (#1133).
 *
 * Both sides are resolved to real paths first, so a symlink planted inside the folder cannot name a
 * file elsewhere (macOS's temporary directory is itself reached through the `/var` → `/private/var`
 * link, which is why the root is resolved too).
 * @param filePath The path, untrusted.
 * @param temporaryRoot The system temporary directory; overridable for tests.
 * @returns Returns the resolved real path when it is a decompiled source, otherwise null.
 */
export async function metadataAsSourcePath(
  filePath: unknown,
  temporaryRoot: string = tmpdir(),
): Promise<string | null> {
  if (typeof filePath !== 'string' || filePath.length === 0 || !path.isAbsolute(filePath)) {
    return null;
  }
  let real: string;
  let root: string;
  try {
    real = await fs.realpath(filePath);
    root = await fs.realpath(path.join(temporaryRoot, METADATA_AS_SOURCE_FOLDER));
  } catch {
    return null;
  }
  const relative: string = path.relative(root, real);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return real;
}
