import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { logger } from './logger';

/**
 * The decisions the store persists: a folder whose repositories the user trusts, or one whose
 * repositories Studio leaves alone.
 */
export type RepositoryTrustChoice = Exclude<RepositoryTrustDecision, 'unknown'>;

/**
 * The shape of the persisted file.
 */
interface PersistedTrust {
  readonly trusted: readonly string[];
  readonly restricted: readonly string[];
}

/**
 * Remembers which repositories the user trusts.
 *
 * A repository can carry settings and scripts that its version-control tool runs the moment it looks
 * at the folder — a Git `core.fsmonitor`, a hooks path, a transport that is a command — so Studio runs
 * no version control in a repository until the user has said they trust it, and remembers the answer.
 * Every repository is asked about, a clone or a new project included: one rule, with no path that
 * skips the question.
 *
 * A decision applies to the folder and everything beneath it, so a trusted worktree container covers
 * each checkout made in it. Where a folder and an ancestor disagree, the nearer decision wins.
 *
 * Owned by the main process: the renderer asks the user and reports the answer, but what the host
 * enforces is read from here, never from the renderer's say-so.
 */
export class RepositoryTrust {
  /**
   * Holds the file the decisions are persisted to.
   */
  private readonly file: string;

  /**
   * Holds the trusted folders.
   */
  private trusted: Set<string>;

  /**
   * Holds the restricted folders.
   */
  private restricted: Set<string>;

  /**
   * Initializes a new instance of the {@link RepositoryTrust} class.
   * @param file The file to persist the decisions to.
   */
  public constructor(file: string) {
    this.file = file;
    const loaded: PersistedTrust = load(file);
    this.trusted = new Set<string>(loaded.trusted);
    this.restricted = new Set<string>(loaded.restricted);
    logger.debug(
      'RepositoryTrust',
      `Loaded ${this.trusted.size} trusted and ${this.restricted.size} restricted folder(s)`,
    );
  }

  /**
   * Gets what the user decided about a folder: the nearest decision on it or an ancestor, or
   * `unknown` when nothing has been decided.
   * @param target The absolute folder.
   * @returns Returns the decision.
   */
  public decisionFor(target: unknown): RepositoryTrustDecision {
    if (typeof target !== 'string' || target.length === 0) {
      return 'unknown';
    }
    let candidate: string = path.resolve(target);
    for (;;) {
      if (this.trusted.has(candidate)) {
        return 'trusted';
      }
      if (this.restricted.has(candidate)) {
        return 'restricted';
      }
      const parent: string = path.dirname(candidate);
      if (parent === candidate) {
        return 'unknown';
      }
      candidate = parent;
    }
  }

  /**
   * Records a decision about a folder, replacing any earlier decision on that exact folder.
   * @param target The absolute folder.
   * @param choice Whether its repositories are trusted or left alone.
   */
  public decide(target: string, choice: RepositoryTrustChoice): void {
    if (target.length === 0) {
      return;
    }
    const resolved: string = path.resolve(target);
    this.trusted.delete(resolved);
    this.restricted.delete(resolved);
    (choice === 'trusted' ? this.trusted : this.restricted).add(resolved);
    logger.info('RepositoryTrust', `${resolved} is now ${choice}`);
    save(this.file, { trusted: [...this.trusted], restricted: [...this.restricted] });
  }
}

/**
 * Loads the persisted decisions, returning none when the file is absent or malformed.
 * @param file The file to read.
 * @returns Returns the decisions.
 */
function load(file: string): PersistedTrust {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) {
      return { trusted: [], restricted: [] };
    }
    const record: Record<string, unknown> = raw as Record<string, unknown>;
    return { trusted: paths(record['trusted']), restricted: paths(record['restricted']) };
  } catch {
    return { trusted: [], restricted: [] };
  }
}

/**
 * Reads a list of absolute paths out of a persisted value, dropping anything else.
 * @param value The persisted value.
 * @returns Returns the paths.
 */
function paths(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry: unknown): entry is string => typeof entry === 'string' && path.isAbsolute(entry),
      )
    : [];
}

/**
 * Persists the decisions, best-effort: a failed write must not stop a repository opening.
 * @param file The file to write.
 * @param value The decisions.
 */
function save(file: string, value: PersistedTrust): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  } catch (error: unknown) {
    logger.warn('RepositoryTrust', 'Could not persist repository trust', error);
  }
}
