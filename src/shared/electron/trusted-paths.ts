import * as fs from 'node:fs';
import * as path from 'node:path';
import { realPathOf } from './ai/write-confinement';
import { logger } from './logger';

/**
 * The most paths remembered of each {@link Origin}; older entries are evicted so the store stays bounded.
 */
const MAX_TRUSTED: number = 500;

/**
 * Names how a path came to be remembered: the user chose it, or it was opened from a workspace.
 *
 * Each is bounded on its own. A few days' work opens hundreds of files, and under one bound they pushed
 * out the folders they were opened from, whose recent items were then refused as missing.
 */
type Origin = 'chosen' | 'opened';

/**
 * Describes a path opened from a workspace, as it is persisted. A chosen path is persisted as a plain
 * string, as every path was before the two were told apart.
 */
interface PersistedOpened {
  /**
   * Gets the path.
   */
  readonly opened: string;
}

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
   * Holds the maximum number of paths retained of each origin.
   */
  private readonly max: number;

  /**
   * Holds the remembered paths and how each came to be, oldest first.
   */
  private readonly entries: Map<string, Origin>;

  /**
   * Initializes a new instance of the {@link TrustedPaths} class.
   * @param file The file to persist the trusted paths to.
   * @param max The maximum number of paths to retain of each origin.
   */
  public constructor(file: string, max: number = MAX_TRUSTED) {
    this.file = file;
    this.max = max;
    this.entries = load(file);
    logger.debug('TrustedPaths', `Loaded ${this.entries.size} trusted path(s)`);
  }

  /**
   * Remembers a path as trusted, moving it to the most-recent position and evicting the oldest paths
   * beyond the retention limit.
   * @param target The absolute path to remember.
   */
  public remember(target: string): void {
    this.add(target, 'chosen');
  }

  /**
   * Remembers a file opened from a workspace, as {@link remember} does but within a bound of its own,
   * so that no number of them evicts a path the user chose. One they chose stays as it is.
   * @param target The absolute path of the file.
   */
  public rememberOpened(target: string): void {
    if (target.length > 0 && this.entries.get(path.resolve(target)) !== 'chosen') {
      this.add(target, 'opened');
    }
  }

  /**
   * Moves a path to the most-recent position, so that one in regular use is never the oldest. Grants
   * nothing: a path that is not remembered, or no longer is, stays that way.
   * @param target The absolute path.
   */
  public refresh(target: string): void {
    const origin: Origin | undefined = this.entries.get(path.resolve(target));
    if (origin !== undefined) {
      this.add(target, origin);
    }
  }

  /**
   * Remembers a path the user chose themselves, by the operating system's dialog or by opening it from
   * outside the app, under the name they chose and under where it really is. The second is what lets
   * a link they picked keep working where the file channels follow links before they check (#1174).
   * Never for a path the renderer named: {@link rememberOpened} is the one for those, because a link planted
   * in a workspace must not turn the file it points at into a trusted one.
   * @param target The absolute path chosen.
   */
  public rememberChosen(target: string): void {
    this.remember(target);
    if (target.length > 0) {
      this.remember(realPathOf(path.resolve(target)));
    }
  }

  /**
   * Determines whether a path has been remembered as trusted.
   * @param target The path to test.
   * @returns Returns true when the path is trusted.
   */
  public has(target: unknown): boolean {
    return (
      typeof target === 'string' && target.length > 0 && this.entries.has(path.resolve(target))
    );
  }

  /**
   * Lists the remembered paths, newest first.
   * @returns Returns the paths.
   */
  public list(): readonly string[] {
    return [...this.entries.keys()].reverse();
  }

  /**
   * Forgets a remembered path, so reopening it needs a dialog again.
   * @param target The path to forget.
   */
  public forget(target: unknown): void {
    if (!this.has(target)) {
      return;
    }
    const resolved: string = path.resolve(target as string);
    logger.info('TrustedPaths', `Forgetting trusted path ${resolved}`);
    this.entries.delete(resolved);
    save(this.file, this.entries);
  }

  /**
   * Forgets every remembered path.
   */
  public clear(): void {
    logger.info('TrustedPaths', `Forgetting all ${this.entries.size} trusted path(s)`);
    this.entries.clear();
    save(this.file, this.entries);
  }

  /**
   * Adds a path at the most-recent position, evicting the oldest of its origin beyond the limit.
   * @param target The absolute path.
   * @param origin How it came to be remembered.
   */
  private add(target: string, origin: Origin): void {
    if (target.length === 0) {
      return;
    }
    const resolved: string = path.resolve(target);
    logger.debug('TrustedPaths', `Remembering trusted path ${resolved} (${origin})`);
    this.entries.delete(resolved);
    this.entries.set(resolved, origin);
    const alike: readonly string[] = [...this.entries.keys()].filter(
      (entry: string): boolean => this.entries.get(entry) === origin,
    );
    for (const oldest of alike.slice(0, Math.max(alike.length - this.max, 0))) {
      this.entries.delete(oldest);
    }
    save(this.file, this.entries);
  }
}

/**
 * Loads the persisted trusted paths, returning none when the file is absent or malformed. A list
 * written before origins were recorded has them inferred (see {@link inferOrigins}).
 * @param file The file to read.
 * @returns Returns the validated paths, oldest first.
 */
function load(file: string): Map<string, Origin> {
  const entries: Map<string, Origin> = new Map<string, Origin>();
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const entry of Array.isArray(raw) ? (raw as readonly unknown[]) : []) {
      const opened: unknown = (entry as Partial<PersistedOpened> | null)?.opened;
      if (typeof entry === 'string' && entry.length > 0) {
        entries.set(entry, 'chosen');
      } else if (typeof opened === 'string' && opened.length > 0) {
        entries.set(opened, 'opened');
      }
    }
  } catch {
    // Absent or malformed: nothing is remembered.
  }
  return inferOrigins(entries);
}

/**
 * Infers the origins of a list written before they were recorded, where every path reads as chosen: one
 * with an extension, inside another remembered path and with none inside it, is taken for a file opened
 * from that folder. Without this such a list fills the chosen paths' bound with files, and the next
 * folder chosen evicts another. A wrong inference costs little: the path stays trusted, in the other
 * bound.
 * @param entries The loaded paths, oldest first.
 * @returns Returns the same paths, in the same order.
 */
function inferOrigins(entries: ReadonlyMap<string, Origin>): Map<string, Origin> {
  const recorded: boolean = [...entries.values()].includes('opened');
  const holders: Set<string> = new Set<string>();
  const within: Set<string> = new Set<string>();
  for (const entry of entries.keys()) {
    let child: string = entry;
    let parent: string = path.dirname(child);
    while (parent !== child) {
      if (entries.has(parent)) {
        holders.add(parent);
        within.add(entry);
      }
      child = parent;
      parent = path.dirname(child);
    }
  }
  return new Map<string, Origin>(
    [...entries].map(([entry, origin]: [string, Origin]): [string, Origin] => [
      entry,
      !recorded && within.has(entry) && !holders.has(entry) && path.extname(entry).length > 0
        ? 'opened'
        : origin,
    ]),
  );
}

/**
 * Persists the trusted paths, silently ignoring write failures.
 * @param file The file to write.
 * @param entries The paths to persist.
 */
function save(file: string, entries: ReadonlyMap<string, Origin>): void {
  try {
    const persisted: readonly (string | PersistedOpened)[] = [...entries].map(
      ([entry, origin]: [string, Origin]): string | PersistedOpened =>
        origin === 'chosen' ? entry : { opened: entry },
    );
    fs.writeFileSync(file, JSON.stringify(persisted));
  } catch {
    // Persistence is best-effort; a failed write must not break opening files.
  }
}
