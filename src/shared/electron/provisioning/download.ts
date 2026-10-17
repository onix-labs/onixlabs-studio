import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
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
export type ArchiveKind = 'tar.gz' | 'zip' | 'gz';

/**
 * Holds the most redirects one download follows before giving up.
 */
const MAX_REDIRECTS: number = 10;

/**
 * Fetches a URL, following redirects by hand so each hop can be inspected: a redirect may go from
 * one https host to another (GitHub release assets are served from objects.githubusercontent.com),
 * but never to plain http, where the payload could be swapped in transit. The digest check would
 * still catch a swapped payload; refusing the downgrade means the request is never made at all.
 * @param url The URL to fetch.
 * @returns Returns the final, non-redirect response.
 */
async function fetchFollowingSecureRedirects(url: string): Promise<Response> {
  let current: string = url;
  for (let hop: number = 0; hop <= MAX_REDIRECTS; hop++) {
    const response: Response = await fetch(current, { redirect: 'manual' });
    const location: string | null = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || location === null) {
      return response;
    }
    const next: URL = new URL(location, current);
    if (next.protocol !== 'https:') {
      throw new Error(
        `Download refused: ${current} redirected to a non-https URL (${next.origin})`,
      );
    }
    current = next.href;
  }
  throw new Error(`Download failed: more than ${MAX_REDIRECTS} redirects from ${url}`);
}

/**
 * Downloads a URL to a file.
 * @param url The URL to download.
 * @param destination The file to write.
 * @returns Returns a promise that resolves once the download completes.
 */
export async function downloadTo(url: string, destination: string): Promise<void> {
  const response: Response = await fetchFollowingSecureRedirects(url);
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
 * @param members The archive members to extract, or empty to extract everything. For an upstream that
 * publishes one archive holding more than the thing being installed — Docker's static package carries
 * the whole engine on Linux and Windows, and only its client is wanted. Narrows what is written to
 * disk; the archive is still downloaded and verified whole, because a hash of part of a file is not a
 * hash of the file.
 * @returns Returns a promise that resolves once extraction completes.
 */
export async function extractArchive(
  archive: string,
  destination: string,
  kind: ArchiveKind,
  stripComponents: number = 0,
  members: readonly string[] = [],
  target: string = '',
): Promise<void> {
  const strip: readonly string[] =
    stripComponents > 0 ? [`--strip-components=${stripComponents}`] : [];
  if (kind === 'gz') {
    // Not an archive at all: a single compressed file, which several projects publish instead of a
    // one-entry tarball. There is nothing inside it to name, so the caller says where it lands.
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(createReadStream(archive), createGunzip(), createWriteStream(target));
    return;
  }
  if (kind === 'tar.gz') {
    await execFileAsync('tar', ['-xzf', archive, '-C', destination, ...strip, ...members]);
    return;
  }
  // `tar` reads zips through libarchive on Windows and modern macOS; `unzip` is the fallback.
  if (process.platform === 'win32') {
    await execFileAsync('tar', ['-xf', archive, '-C', destination, ...strip, ...members]);
    return;
  }
  // `unzip` wants the members before the destination flag, unlike tar's trailing operands.
  await execFileAsync('unzip', ['-q', '-o', archive, ...members, '-d', destination]);
  // Info-ZIP already drops `../` and leading `/` from entry names, but it restores symlinks verbatim,
  // and a link pointing out of the destination would hand whatever later follows it — the install
  // itself, or the server it launches — a path outside the install. It creates links only after every
  // file is written, so nothing was written through one during extraction; checking afterwards is
  // enough.
  await refuseEscapingSymlinks(destination);
}

/**
 * Walks an extracted tree and refuses it if any symlink in it points outside the tree. Each link is
 * resolved lexically against its own directory, so a chain of links stays inside as long as every
 * link in it does, and a dangling link is judged by where it would point. The offending links are
 * removed before throwing, so a failed extraction does not leave them for a later caller to follow.
 * @param destination The directory the archive was extracted into.
 * @returns Returns a promise that resolves when every link stays inside, or rejects naming the first
 * that does not.
 */
export async function refuseEscapingSymlinks(destination: string): Promise<void> {
  const root: string = await fs.realpath(destination);
  const escaping: string[] = [];
  const entries: string[] = await fs.readdir(root, { recursive: true });
  for (const entry of entries) {
    const link: string = path.join(root, entry);
    if (!(await fs.lstat(link)).isSymbolicLink()) {
      continue;
    }
    const target: string = path.resolve(path.dirname(link), await fs.readlink(link));
    const relative: string = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      escaping.push(entry);
    }
  }
  if (escaping.length === 0) {
    return;
  }
  for (const entry of escaping) {
    await fs.rm(path.join(root, entry), { force: true });
  }
  throw new Error(`Archive refused: the symlink ${escaping[0]} points outside the destination`);
}
