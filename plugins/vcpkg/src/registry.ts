// Reads vcpkg's built-in registry: the `versions/baseline.json` it publishes at every commit.
//
// A baseline is the whole registry's answer to "which version of each port?" at one commit, so one
// file answers every port a manifest names. The manifest's `builtin-baseline` commit gives the version
// it resolves to; the file on `master` gives the latest. There is no search API: the port list *is*
// the current baseline's keys, so a search is a filter over them, done here.
//
// A baseline at a commit never changes, so those are kept for the life of the process. `master` moves,
// so it is kept for a while and then fetched again.

import { note } from './log';
import { HttpFetch, HttpResponse } from './protocol';
import { formatVersion } from './versions';

/**
 * Where the built-in registry's files are published, by commit: GitHub's raw-file host for
 * `microsoft/vcpkg`. Public, so no credential is ever sent to it.
 */
export const DEFAULT_REGISTRY: string = 'https://raw.githubusercontent.com/microsoft/vcpkg';

/**
 * How long the `master` baseline is trusted before it is fetched again. A search runs as the user
 * types, and must not fetch a quarter of a megabyte per keystroke.
 */
const MASTER_TTL_MS: number = 15 * 60_000;

/**
 * How many commit baselines are kept: a workspace pins a handful at most.
 */
const PINNED_LIMIT: number = 16;

/**
 * The versions a baseline gives, by port name, written as vcpkg writes them (`1.3.1#3`).
 */
export type Baseline = ReadonlyMap<string, string>;

/**
 * Parses a `baseline.json`.
 * @param body The parsed file.
 * @returns Returns the versions by port, or null when it is not a baseline.
 */
export function parseBaseline(body: unknown): Baseline | null {
  const ports: unknown =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['default'] : null;
  if (typeof ports !== 'object' || ports === null) {
    return null;
  }
  const versions: Map<string, string> = new Map<string, string>();
  for (const [name, entry] of Object.entries(ports as Record<string, unknown>)) {
    const record: Record<string, unknown> | null =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    const version: unknown = record?.['baseline'];
    const port: unknown = record?.['port-version'];
    if (typeof version === 'string') {
      versions.set(name, formatVersion(version, typeof port === 'number' ? port : 0));
    }
  }
  return versions;
}

/**
 * Fetches baselines from the built-in registry and keeps them.
 */
export class BaselineStore {
  /**
   * Holds where the registry's files are published.
   */
  private readonly registry: string;

  /**
   * Holds the fetch requests go through.
   */
  private readonly fetchFn: HttpFetch;

  /**
   * Holds the commit baselines fetched, or being fetched, by commit.
   */
  private readonly pinned: Map<string, Promise<Baseline | null>> = new Map<
    string,
    Promise<Baseline | null>
  >();

  /**
   * Holds the `master` baseline and when it was asked for, or null before the first ask.
   */
  private master: { readonly at: number; readonly baseline: Promise<Baseline | null> } | null =
    null;

  /**
   * Initializes the store.
   * @param registry Where the registry's files are published, without a trailing slash.
   * @param fetchFn The fetch requests go through.
   */
  public constructor(registry: string, fetchFn: HttpFetch) {
    this.registry = registry.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }

  /**
   * Gets the baseline at a commit.
   * @param commit The commit, already checked to be a sha.
   * @returns Returns the baseline, or null when it could not be fetched.
   */
  public async at(commit: string): Promise<Baseline | null> {
    let pending: Promise<Baseline | null> | undefined = this.pinned.get(commit);
    if (pending === undefined) {
      if (this.pinned.size >= PINNED_LIMIT) {
        this.pinned.clear();
      }
      pending = this.fetchBaseline(commit);
      this.pinned.set(commit, pending);
    }
    const baseline: Baseline | null = await pending;
    if (baseline === null) {
      // A failure is not kept: the next load tries again.
      this.pinned.delete(commit);
    }
    return baseline;
  }

  /**
   * Gets the current baseline, the registry's latest versions.
   * @returns Returns the baseline, or null when it could not be fetched.
   */
  public async latest(): Promise<Baseline | null> {
    const now: number = Date.now();
    if (this.master === null || now - this.master.at > MASTER_TTL_MS) {
      this.master = { at: now, baseline: this.fetchBaseline('master') };
    }
    const baseline: Baseline | null = await this.master.baseline;
    if (baseline === null) {
      this.master = null;
    }
    return baseline;
  }

  /**
   * Fetches and parses one baseline.
   * @param ref The commit, or `master`.
   * @returns Returns the baseline, or null when it could not be fetched or read.
   */
  private async fetchBaseline(ref: string): Promise<Baseline | null> {
    try {
      const response: HttpResponse = await this.fetchFn(
        `${this.registry}/${ref}/versions/baseline.json`,
      );
      if (!response.ok) {
        note('vcpkg', `The registry answered ${response.status} for a baseline`);
        return null;
      }
      return parseBaseline(await response.json());
    } catch (error: unknown) {
      note('vcpkg', `A baseline could not be fetched: ${(error as Error).message}`);
      return null;
    }
  }
}
