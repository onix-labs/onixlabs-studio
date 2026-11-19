import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PersonaChange, PeteQuestion, PeteState } from '@shared/api/pete-protocol';
import { logger } from '@shared/electron/logger';
import { readEntry } from './persona-library';

/**
 * The file, inside the persona folder, that holds Pete's records.
 */
const PETE_FILE: string = 'pete.json';

/**
 * How many applied changes are kept for the user to look through and undo.
 */
const RECENT_LIMIT: number = 200;

/**
 * How many changes may wait for review before the oldest are dropped.
 */
const PENDING_LIMIT: number = 500;

/**
 * How many messages Pete remembers having read in one conversation.
 */
const READ_LIMIT: number = 2_000;

/**
 * How many open questions Pete keeps (#1519): a short list, so they stay worth answering.
 */
const QUESTION_LIMIT: number = 10;

/**
 * Pete's records as they are written to disk.
 *
 * 🔑 What Pete has read is kept by conversation and message id, and is the only thing anywhere that
 * names a conversation. It never reaches an entry: the persona stands on its own, and a conversation
 * deleted later only leaves a stale line here, pruned on the next run.
 */
export interface PeteRecords {
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
  readonly questions: readonly PeteQuestion[];

  /**
   * Gets when Pete last finished a run (epoch milliseconds), or 0.
   */
  readonly lastRun: number;

  /**
   * Gets how many runs in a row failed on each conversation's unread messages, so one that keeps
   * failing is skipped rather than retried forever.
   */
  readonly failures: Readonly<Record<string, number>>;
}

/**
 * The records of a persona Pete has never run on.
 */
export const EMPTY_PETE_RECORDS: PeteRecords = {
  read: {},
  ruledOut: [],
  recent: [],
  pending: [],
  questions: [],
  lastRun: 0,
  failures: {},
};

/**
 * Pete's records on disk (#1516): a JSON file beside the persona's entries. Reads and writes go one at
 * a time through {@link update}, so a run finishing while the user undoes a change cannot lose either.
 */
export class PeteStore {
  /**
   * Holds the tail of the queue every update waits its turn on.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Initializes a new instance of the {@link PeteStore} class.
   * @param root The persona folder.
   */
  public constructor(private readonly root: string) {}

  /**
   * Reads the records.
   * @returns Returns them, or the empty records when there are none or they cannot be read.
   */
  public async read(): Promise<PeteRecords> {
    await this.queue.catch((): void => undefined);
    return this.load();
  }

  /**
   * Changes the records, one change at a time.
   * @param change Returns the new records from the old, and a result for the caller.
   * @returns Returns the result.
   */
  public update<TResult>(
    change: (records: PeteRecords) => Promise<[PeteRecords, TResult]> | [PeteRecords, TResult],
  ): Promise<TResult> {
    const run: Promise<TResult> = this.queue
      .catch((): void => undefined)
      .then(async (): Promise<TResult> => {
        const [next, result]: [PeteRecords, TResult] = await change(await this.load());
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
  public async state(): Promise<PeteState> {
    const records: PeteRecords = await this.read();
    return {
      recent: [...records.recent].reverse(),
      pending: records.pending,
      ruledOut: records.ruledOut,
      questions: records.questions,
      lastRun: records.lastRun,
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
  private async load(): Promise<PeteRecords> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(join(this.root, PETE_FILE), 'utf8'));
    } catch {
      return EMPTY_PETE_RECORDS;
    }
    return readRecords(parsed);
  }

  /**
   * Writes the file, beside it first and then over it.
   * @param records The records.
   * @returns Resolves once written.
   */
  private async write(records: PeteRecords): Promise<void> {
    const path: string = join(this.root, PETE_FILE);
    const staged: string = `${path}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(staged, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      await fs.rename(staged, path);
    } catch (error: unknown) {
      await fs.rm(staged, { force: true }).catch((): void => undefined);
      logger.warn('PeteStore.write', "Could not write Pete's records", error);
      throw error;
    }
  }
}

/**
 * Keeps the records within their bounds.
 * @param records The records.
 * @returns Returns the bounded records.
 */
function bound(records: PeteRecords): PeteRecords {
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
export function readRecords(value: unknown): PeteRecords {
  if (value === null || typeof value !== 'object') {
    return EMPTY_PETE_RECORDS;
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
  const questions: PeteQuestion[] = [];
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
