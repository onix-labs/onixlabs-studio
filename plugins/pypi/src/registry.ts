// Asks an index about one package: PyPI through its JSON API (`/pypi/<name>/json`), any other index
// through the JSON form of the simple API (PEP 691), where the index serves it. An index that serves
// only the older HTML form answers nothing here, and its packages show no latest version rather than a
// guessed one.
//
// PyPI has no search API at all (its XML-RPC search was switched off in 2020), so a "search" is a
// lookup of one exact name, which is what both answer.

import { PipIndex } from './pip-config';
import { HttpFetch, HttpResponse } from './protocol';
import { newestRelease } from './versions';
import { normaliseName } from './requirements';

/**
 * The User-Agent every request carries, so an index's operators can tell what is asking.
 */
export const USER_AGENT: string =
  'onixlabs-studio-pypi/0.1.0 (+https://github.com/onix-labs/onixlabs-studio)';

/**
 * The media type of the simple API's JSON form, version 1.
 */
const SIMPLE_JSON: string = 'application/vnd.pypi.simple.v1+json';

/**
 * PyPI's JSON API.
 */
const PYPI_JSON_API: string = 'https://pypi.org/pypi';

/**
 * What an index says about one package.
 */
export interface PackageFacts {
  /**
   * Gets the package's name, as the index spells it.
   */
  readonly name: string;

  /**
   * Gets its newest release, or null when it has none the index lists.
   */
  readonly latest: string | null;

  /**
   * Gets its one-line summary, empty when the index gives none.
   */
  readonly summary: string;
}

/**
 * Asks an index about one package. Never throws: a failure, a missing package or a body this cannot
 * read is no answer.
 * @param name The package name.
 * @param index The index.
 * @param fetchFn The fetch.
 * @returns Returns what the index says, or null.
 */
export async function lookUpPackage(
  name: string,
  index: PipIndex,
  fetchFn: HttpFetch,
): Promise<PackageFacts | null> {
  const normalised: string = encodeURIComponent(normaliseName(name));
  try {
    if (index.isPypi) {
      const response: HttpResponse = await fetchFn(`${PYPI_JSON_API}/${normalised}/json`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      });
      return response.ok ? factsFromPypiJson(await response.json()) : null;
    }
    const response: HttpResponse = await fetchFn(`${index.url}${normalised}/`, {
      headers: { ...index.headers, Accept: SIMPLE_JSON, 'User-Agent': USER_AGENT },
    });
    return response.ok ? factsFromSimpleJson(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Reads PyPI's JSON API answer. The newest release is worked out from `releases`, skipping
 * pre-releases and versions whose every file is yanked; `info.version` is the fallback.
 * @param body The parsed answer.
 * @returns Returns the facts, or null when it is not such an answer.
 */
export function factsFromPypiJson(body: unknown): PackageFacts | null {
  const info: Record<string, unknown> | null = record(record(body)?.['info']);
  const name: unknown = info?.['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  const releases: Record<string, unknown> = record(record(body)?.['releases']) ?? {};
  const available: string[] = Object.entries(releases)
    .filter(
      ([, files]: [string, unknown]): boolean =>
        Array.isArray(files) && files.length > 0 && !allYanked(files),
    )
    .map(([version]: [string, unknown]): string => version);
  const fallback: unknown = info?.['version'];
  const summary: unknown = info?.['summary'];
  return {
    name,
    latest:
      newestRelease(available) ??
      (typeof fallback === 'string' && fallback.length > 0 ? fallback : null),
    summary: typeof summary === 'string' ? summary : '',
  };
}

/**
 * Reads a PEP 691 project page. Its `versions` (PEP 700) are used when it lists them, with the
 * versions whose every file is yanked taken out; otherwise the versions are read from the file names.
 * @param body The parsed answer.
 * @returns Returns the facts, or null when it is not such an answer.
 */
export function factsFromSimpleJson(body: unknown): PackageFacts | null {
  const page: Record<string, unknown> | null = record(body);
  const name: unknown = page?.['name'];
  const files: readonly unknown[] = Array.isArray(page?.['files'])
    ? (page['files'] as unknown[])
    : [];
  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }
  const byVersion: Map<string, unknown[]> = new Map<string, unknown[]>();
  for (const file of files) {
    const version: string | null = versionOfFile(record(file)?.['filename']);
    if (version !== null) {
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }
  }
  const listed: unknown = page?.['versions'];
  const versions: readonly string[] = Array.isArray(listed)
    ? listed.filter((version: unknown): version is string => typeof version === 'string')
    : [...byVersion.keys()];
  const available: readonly string[] = versions.filter((version: string): boolean => {
    const its: readonly unknown[] | undefined = byVersion.get(version);
    return its === undefined ? !Array.isArray(listed) : !allYanked(its);
  });
  return { name, latest: newestRelease(available), summary: '' };
}

/**
 * Reads the version out of a distribution's file name: a wheel's second field
 * (`name-1.0-py3-none-any.whl`), or what follows an sdist's last dash (`name-1.0.tar.gz`).
 * @param filename The file name.
 * @returns Returns the version, or null when the name is neither.
 */
function versionOfFile(filename: unknown): string | null {
  if (typeof filename !== 'string') {
    return null;
  }
  if (filename.endsWith('.whl')) {
    return filename.split('-')[1] ?? null;
  }
  const sdist: RegExpExecArray | null = /^.+-([^-]+)\.(tar\.gz|zip|tar\.bz2|tgz)$/.exec(filename);
  return sdist === null ? null : sdist[1];
}

/**
 * Determines whether every file of a release is yanked, so the release is not one to move to.
 * @param files The release's files.
 * @returns Returns true when each is.
 */
function allYanked(files: readonly unknown[]): boolean {
  return files.every((file: unknown): boolean => {
    const yanked: unknown = record(file)?.['yanked'];
    // PEP 691: `true`, or a string giving the reason, both mean yanked.
    return yanked === true || typeof yanked === 'string';
  });
}

/**
 * Reads a value as a JSON object.
 * @param value The value.
 * @returns Returns it as a record, or null when it is not an object.
 */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
