import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  PersonaChange,
  PersonaRebuildJob,
  PersonaQuestion,
  LearningState,
} from '@shared/api/persona-learning-protocol';
import { logger } from '@shared/electron/logger';
import { readEntry } from './persona-library';

/**
 * The file, inside the persona folder, that holds the learning records.
 */
const LEARNING_FILE: string = 'learning.json';

/**
 * How many applied changes are kept for the user to look through and undo.
 */
const RECENT_LIMIT: number = 200;

/**
 * How many changes may wait for review before the oldest are dropped.
 */
const PENDING_LIMIT: number = 500;

/**
 * How many messages persona learning remembers having read in one conversation.
 */
const READ_LIMIT: number = 2_000;

/**
 * How many open questions persona learning keeps (#1519): a short list, so they stay worth answering.
 */
const QUESTION_LIMIT: number = 10;

/**
 * the learning records as they are written to disk.
 *
 * 🔑 What persona learning has read is kept by conversation and message id, and is the only thing anywhere that
 * names a conversation. It never reaches an entry: the persona stands on its own, and a conversation
 * deleted later only leaves a stale line here, pruned on the next run.
 */
export interface LearningRecords {
  /**
   * Gets the ids of the messages read, by conversation.
   */
  readonly read: Readonly<Record<string, readonly string[]>>;

  /**
   * Gets the topics never to learn about.
   */
  readonly ruledOut: readonly string[];

  /**
   * Gets the changes applied, newest last, for the user to look through and undo.
   */
  readonly recent: readonly PersonaChange[];

  /**
   * Gets the changes waiting for review, oldest first.
   */
  readonly pending: readonly PersonaChange[];

  /**
   * Gets the open questions.
   */
  readonly questions: readonly PersonaQuestion[];

  /**
   * Gets when persona learning last finished a run (epoch milliseconds), or 0.
   */
  readonly lastRun: number;

  /**
   * Gets how many runs in a row failed on each conversation's unread messages, so one that keeps
   * failing is skipped rather than retried forever.
   */
  readonly failures: Readonly<Record<string, number>>;

  /**
   * Gets the full rebuild under way (#1518), with its own record of the messages it has read, or null.
   */
  readonly rebuild: StoredRebuild | null;

  /**
   * Gets when fading last ran (epoch milliseconds), or 0 (#1519).
   */
  readonly lastFaded: number;
}

/**
 * A rebuild as it is kept on disk: the job, and the messages it has read by conversation. Its own
 * record rather than the everyday one, because a rebuild reads everything again.
 */
export interface StoredRebuild extends PersonaRebuildJob {
  readonly read: Readonly<Record<string, readonly string[]>>;
}

/**
 * The records of a persona persona learning has never run on.
 */
export const EMPTY_LEARNING_RECORDS: LearningRecords = {
  read: {},
  ruledOut: [],
  recent: [],
  pending: [],
  questions: [],
  lastRun: 0,
  failures: {},
  rebuild: null,
  lastFaded: 0,
};

/**
 * the learning records on disk (#1516): a JSON file beside the persona's entries. Reads and writes go one at
 * a time through {@link update}, so a run finishing while the user undoes a change cannot lose either.
 */
export class PersonaLearningStore {
  /**
   * Holds the tail of the queue every update waits its turn on.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Initializes a new instance of the {@link PersonaLearningStore} class.
   * @param root The persona folder.
   */
  public constructor(private readonly root: string) {}

  /**
   * Reads the records.
   * @returns Returns them, or the empty records when there are none or they cannot be read.
   */
  public async read(): Promise<LearningRecords> {
    await this.queue.catch((): void => undefined);
    return this.load();
  }

  /**
   * Changes the records, one change at a time.
   * @param change Returns the new records from the old, and a result for the caller.
   * @returns Returns the result.
   */
  public update<TResult>(
    change: (
      records: LearningRecords,
    ) => Promise<[LearningRecords, TResult]> | [LearningRecords, TResult],
  ): Promise<TResult> {
    const run: Promise<TResult> = this.queue
      .catch((): void => undefined)
      .then(async (): Promise<TResult> => {
        const [next, result]: [LearningRecords, TResult] = await change(await this.load());
        await this.write(bound(next));
        return result;
      });
    this.queue = run;
    return run;
  }

  /**
   * Gets the records as the Persona page shows them.
   * @returns Returns the state.
   */
  public async state(): Promise<LearningState> {
    const records: LearningRecords = await this.read();
    return {
      recent: [...records.recent].reverse(),
      pending: records.pending,
      ruledOut: records.ruledOut,
      questions: records.questions,
      lastRun: records.lastRun,
      rebuild:
        records.rebuild === null
          ? null
          : {
              mode: records.rebuild.mode,
              connectionId: records.rebuild.connectionId,
              model: records.rebuild.model,
              startedAt: records.rebuild.startedAt,
              total: records.rebuild.total,
              done: records.rebuild.done,
            },
    };
  }

  /**
   * Makes an id for a change or question.
   * @returns Returns the id.
   */
  public static newId(): string {
    return randomUUID();
  }

  /**
   * Reads the file.
   * @returns Returns the records.
   */
  private async load(): Promise<LearningRecords> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(join(this.root, LEARNING_FILE), 'utf8'));
    } catch {
      return EMPTY_LEARNING_RECORDS;
    }
    return readRecords(parsed);
  }

  /**
   * Writes the file, beside it first and then over it.
   * @param records The records.
   * @returns Resolves once written.
   */
  private async write(records: LearningRecords): Promise<void> {
    const path: string = join(this.root, LEARNING_FILE);
    const staged: string = `${path}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(staged, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      await fs.rename(staged, path);
    } catch (error: unknown) {
      await fs.rm(staged, { force: true }).catch((): void => undefined);
      logger.warn('PersonaLearningStore.write', 'Could not write the learning records', error);
      throw error;
    }
  }
}

/**
 * Keeps the records within their bounds.
 * @param records The records.
 * @returns Returns the bounded records.
 */
function bound(records: LearningRecords): LearningRecords {
  const read: Record<string, readonly string[]> = {};
  for (const [conversation, ids] of Object.entries(records.read)) {
    read[conversation] = ids.slice(-READ_LIMIT);
  }
  return {
    ...records,
    read,
    recent: records.recent.slice(-RECENT_LIMIT),
    pending: records.pending.slice(-PENDING_LIMIT),
    questions: records.questions.slice(-QUESTION_LIMIT),
  };
}

/**
 * Reads the records out of the parsed file, dropping anything malformed.
 * @param value The parsed file.
 * @returns Returns the records.
 */
export function readRecords(value: unknown): LearningRecords {
  if (value === null || typeof value !== 'object') {
    return EMPTY_LEARNING_RECORDS;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const read: Record<string, readonly string[]> = {};
  const rawRead: unknown = record['read'];
  if (rawRead !== null && typeof rawRead === 'object') {
    for (const [conversation, ids] of Object.entries(rawRead as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        read[conversation] = ids.filter((id: unknown): id is string => typeof id === 'string');
      }
    }
  }
  const failures: Record<string, number> = {};
  const rawFailures: unknown = record['failures'];
  if (rawFailures !== null && typeof rawFailures === 'object') {
    for (const [conversation, count] of Object.entries(rawFailures as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count)) {
        failures[conversation] = count;
      }
    }
  }
  const strings: (key: string) => readonly string[] = (key: string): readonly string[] => {
    const list: unknown = record[key];
    return Array.isArray(list)
      ? list.filter((item: unknown): item is string => typeof item === 'string')
      : [];
  };
  const changes: (key: string) => readonly PersonaChange[] = (
    key: string,
  ): readonly PersonaChange[] => {
    const list: unknown = record[key];
    return Array.isArray(list)
      ? list
          .map(readChangeRecord)
          .filter((change: PersonaChange | null): change is PersonaChange => change !== null)
      : [];
  };
  const questions: PersonaQuestion[] = [];
  const rawQuestions: unknown = record['questions'];
  for (const item of Array.isArray(rawQuestions) ? (rawQuestions as unknown[]) : []) {
    if (item !== null && typeof item === 'object') {
      const question: Record<string, unknown> = item as Record<string, unknown>;
      if (typeof question['id'] === 'string' && typeof question['text'] === 'string') {
        questions.push({
          id: question['id'],
          text: question['text'],
          asked: typeof question['asked'] === 'number' ? question['asked'] : 0,
        });
      }
    }
  }
  const lastRun: unknown = record['lastRun'];
  return {
    read,
    ruledOut: strings('ruledOut'),
    recent: changes('recent'),
    pending: changes('pending'),
    questions,
    lastRun: typeof lastRun === 'number' && Number.isFinite(lastRun) ? lastRun : 0,
    failures,
    rebuild: readRebuild(record['rebuild']),
    lastFaded:
      typeof record['lastFaded'] === 'number' && Number.isFinite(record['lastFaded'])
        ? record['lastFaded']
        : 0,
  };
}

/**
 * Reads the rebuild under way.
 * @param value The value.
 * @returns Returns the rebuild, or null when there is none or it is malformed.
 */
function readRebuild(value: unknown): StoredRebuild | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (
    typeof record['connectionId'] !== 'string' ||
    typeof record['model'] !== 'string' ||
    typeof record['startedAt'] !== 'number' ||
    typeof record['total'] !== 'number'
  ) {
    return null;
  }
  const read: Record<string, readonly string[]> = {};
  const rawRead: unknown = record['read'];
  if (rawRead !== null && typeof rawRead === 'object') {
    for (const [conversation, ids] of Object.entries(rawRead as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        read[conversation] = ids.filter((id: unknown): id is string => typeof id === 'string');
      }
    }
  }
  const done: unknown = record['done'];
  return {
    mode: record['mode'] === 'fresh' ? 'fresh' : 'merge',
    connectionId: record['connectionId'],
    model: record['model'],
    startedAt: record['startedAt'],
    total: record['total'],
    done: Array.isArray(done)
      ? done.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    read,
  };
}

/**
 * Reads one recorded change.
 * @param value The value.
 * @returns Returns the change, or null when it is malformed.
 */
function readChangeRecord(value: unknown): PersonaChange | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const kind: unknown = record['kind'];
  if (
    typeof record['id'] !== 'string' ||
    typeof record['entryId'] !== 'string' ||
    typeof record['at'] !== 'number' ||
    (kind !== 'add' && kind !== 'change' && kind !== 'remove')
  ) {
    return null;
  }
  const before: unknown = record['before'];
  const after: unknown = record['after'];
  return {
    id: record['id'],
    at: record['at'],
    kind,
    entryId: record['entryId'],
    before: before === null || before === undefined ? null : readEntry(before),
    after: after === null || after === undefined ? null : readEntry(after),
    reason: typeof record['reason'] === 'string' ? record['reason'] : '',
  };
}
