import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

// The primitives every provisioner is built from: fetch a file, hash it, and — only once the hash
// matches what was pinned — unpack it. They live here rather than on a provisioner because there is now
// more than one, and two copies of the code that fetches and verifies executable payloads is one copy
// too many. The ordering they exist to enforce is the whole point: nothing is extracted, and therefore
// nothing can be run, until a caller has compared a digest.

/**
 * Runs a child process and resolves with its output, used to shell out to the platform's extractor.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * The archive kinds the extractor understands.
 */
export type ArchiveKind = 'tar.gz' | 'zip';

/**
 * Downloads a URL to a file.
 * @param url The URL to download.
 * @param destination The file to write.
 * @returns Returns a promise that resolves once the download completes.
 */
export async function downloadTo(url: string, destination: string): Promise<void> {
  const response: Response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: ${response.status}`);
  }
  // The two compilations disagree about this type: under the main process's Node libs the cast is
  // redundant, while under the renderer's DOM libs `ReadableStream` is the DOM one and the call will
  // not typecheck without it. The cast keeps this module importable from a spec, which is what makes
  // the code that runs downloaded executables testable at all.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const body: Parameters<typeof Readable.fromWeb>[0] = response.body as Parameters<
    typeof Readable.fromWeb
  >[0];
  await pipeline(Readable.fromWeb(body), createWriteStream(destination));
}

/**
 * Computes a file's SHA-256.
 * @param file The file to hash.
 * @returns Returns the lower-case hex digest.
 */
export async function sha256Of(file: string): Promise<string> {
  const hash: ReturnType<typeof createHash> = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Computes a file's Subresource Integrity string — `<algorithm>-<base64>` — which is the form an npm
 * lockfile records, so the comparison against one is verbatim with nothing re-encoded in between.
 * @param file The file to hash.
 * @param algorithm The hash algorithm, as named in the integrity string.
 * @returns Returns the integrity string.
 */
export async function integrityOf(file: string, algorithm: string): Promise<string> {
  const hash: ReturnType<typeof createHash> = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return `${algorithm}-${hash.digest('base64')}`;
}

/**
 * Extracts an archive into a directory using the platform's available extractor.
 * @param archive The archive path.
 * @param destination The directory to extract into.
 * @param kind The archive kind.
 * @param stripComponents How many leading path components to drop, for archives rooted at a directory
 * that is not wanted (an npm tarball's `package/`). Only meaningful for tar.
 * @returns Returns a promise that resolves once extraction completes.
 */
export async function extractArchive(
  archive: string,
  destination: string,
  kind: ArchiveKind,
  stripComponents: number = 0,
): Promise<void> {
  const strip: readonly string[] =
    stripComponents > 0 ? [`--strip-components=${stripComponents}`] : [];
  if (kind === 'tar.gz') {
    await execFileAsync('tar', ['-xzf', archive, '-C', destination, ...strip]);
    return;
  }
  // `tar` reads zips through libarchive on Windows and modern macOS; `unzip` is the fallback.
  if (process.platform === 'win32') {
    await execFileAsync('tar', ['-xf', archive, '-C', destination, ...strip]);
    return;
  }
  await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination]);
}
