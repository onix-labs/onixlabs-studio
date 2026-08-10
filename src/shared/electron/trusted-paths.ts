import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger';

/**
 * The most paths remembered; older entries are evicted so the store stays bounded.
 */
const MAX_TRUSTED: number = 500;

/**
 * Remembers the file-system paths the user has explicitly opened through an operating-system dialog,
 * so a later "open recent" request can be re-authorised without a fresh dialog while still refusing
 * any path the user never chose.
 *
 * The main process treats the renderer as hostile, so it will not read a file or folder outside the
 * open workspace roots on the renderer's say-so. Recent items are useful only if they can be re-opened
 * across restarts, so this store — owned by the main process and persisted to disk — records the paths
 * the user genuinely picked and gates re-opens against them.
 */
export class TrustedPaths {
  /**
   * Holds the file the trusted paths are persisted to.
   */
  private readonly file: string;

  /**
   * Holds the maximum number of paths retained.
   */
  private readonly max: number;

  /**
   * Holds the remembered paths, oldest first.
   */
  private entries: string[];

  /**
   * Holds the remembered paths as a set for constant-time membership tests.
   */
  private index: Set<string>;

  /**
   * Initializes a new instance of the {@link TrustedPaths} class.
   * @param file The file to persist the trusted paths to.
   * @param max The maximum number of paths to retain.
   */
  public constructor(file: string, max: number = MAX_TRUSTED) {
    this.file = file;
    this.max = max;
    this.entries = load(file);
    this.index = new Set<string>(this.entries);
    logger.debug('TrustedPaths', `Loaded ${this.entries.length} trusted path(s)`);
  }

  /**
   * Remembers a path as trusted, moving it to the most-recent position and evicting the oldest paths
   * beyond the retention limit.
   * @param target The absolute path to remember.
   */
  public remember(target: string): void {
    if (target.length === 0) {
      return;
    }
    const resolved: string = path.resolve(target);
    logger.debug('TrustedPaths', `Remembering trusted path ${resolved}`);
    this.entries = this.entries.filter((entry: string): boolean => entry !== resolved);
    this.entries.push(resolved);
    if (this.entries.length > this.max) {
      this.entries = this.entries.slice(this.entries.length - this.max);
    }
    this.index = new Set<string>(this.entries);
    save(this.file, this.entries);
  }

  /**
   * Determines whether a path has been remembered as trusted.
   * @param target The path to test.
   * @returns Returns true when the path is trusted.
   */
  public has(target: unknown): boolean {
    return typeof target === 'string' && target.length > 0 && this.index.has(path.resolve(target));
  }
}

/**
 * Loads the persisted trusted paths, returning an empty list when the file is absent or malformed.
 * @param file The file to read.
 * @returns Returns the validated list of paths.
 */
function load(file: string): string[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter(
      (entry: unknown): entry is string => typeof entry === 'string' && entry.length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Persists the trusted paths, silently ignoring write failures.
 * @param file The file to write.
 * @param entries The paths to persist.
 */
function save(file: string, entries: readonly string[]): void {
  try {
    fs.writeFileSync(file, JSON.stringify(entries));
  } catch {
    // Persistence is best-effort; a failed write must not break opening files.
  }
}
