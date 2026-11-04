import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogRecord, LogSession } from '@shared/api/log-channels';
import { LogArchive } from './log-archive';

/**
 * Builds a record with sensible defaults, overridable per test.
 * @param over The fields to override.
 * @returns Returns the record.
 */
function record(over: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 1,
    sessionId: 'session-a',
    timestamp: '2026-08-10T00:00:00.000Z',
    severity: 'info',
    origin: 'main',
    source: 'test',
    message: 'hello',
    ...over,
  };
}

describe('LogArchive', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'log-archive-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persist_appendsOneJsonLinePerRecordToTheSessionFile', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.persist(record({ id: 1, message: 'a' }));
    archive.persist(record({ id: 2, message: 'b' }));
    const reloaded: readonly LogRecord[] = archive.readSession('session-a');
    expect(reloaded.map((entry: LogRecord): string => entry.message)).toEqual(['a', 'b']);
  });

  it('persist_writesEachSessionToItsOwnFile', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.persist(record({ sessionId: 'session-a', message: 'from-a' }));
    archive.persist(record({ sessionId: 'session-b', message: 'from-b' }));
    expect(archive.readSession('session-a')).toHaveLength(1);
    expect(archive.readSession('session-b')[0].message).toBe('from-b');
  });

  it('readSession_returnsEmptyForAnUnknownSession', () => {
    expect(new LogArchive(dir).readSession('nope')).toEqual([]);
  });

  it('readSession_skipsMalformedLines', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.persist(record({ message: 'good' }));
    writeFileSync(join(archive.sessionsDirectory, 'session-a.jsonl'), '{not json}\n{"broken\n', {
      flag: 'a',
    });
    const reloaded: readonly LogRecord[] = archive.readSession('session-a');
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].message).toBe('good');
  });

  it('sessions_includesTheCurrentSessionFlaggedLiveNewestFirst', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.persist(record({ sessionId: 'past-1' }));
    const current: LogSession = {
      id: 'current',
      startedAt: '2999-01-01T00:00:00.000Z',
      current: true,
    };
    const sessions: readonly LogSession[] = archive.sessions(current);
    expect(sessions[0]).toEqual(current);
    expect(sessions.some((session: LogSession): boolean => session.id === 'past-1')).toBe(true);
    expect(sessions.find((session: LogSession): boolean => session.id === 'past-1')?.current).toBe(
      false,
    );
  });

  it('sessions_returnsOnlyTheCurrentWhenNoFilesExist', () => {
    const current: LogSession = {
      id: 'current',
      startedAt: '2026-08-10T00:00:00.000Z',
      current: true,
    };
    expect(new LogArchive(dir).sessions(current)).toEqual([current]);
  });

  it('enqueue_buffersRecordsUntilFlush', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.enqueue(record({ id: 1, message: 'a' }));
    archive.enqueue(record({ id: 2, message: 'b' }));
    expect(archive.readSession('session-a')).toEqual([]);
    expect(archive.pendingCount).toBe(2);
    archive.flush();
    expect(
      archive.readSession('session-a').map((entry: LogRecord): string => entry.message),
    ).toEqual(['a', 'b']);
    expect(archive.pendingCount).toBe(0);
  });

  it('flush_writesEachSessionsBatchToItsOwnFile', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.enqueue(record({ sessionId: 'session-a', message: 'from-a' }));
    archive.enqueue(record({ sessionId: 'session-b', message: 'from-b' }));
    archive.enqueue(record({ sessionId: 'session-a', id: 2, message: 'also-a' }));
    archive.flush();
    expect(archive.readSession('session-a')).toHaveLength(2);
    expect(archive.readSession('session-b')[0].message).toBe('from-b');
  });

  it('flush_isIdempotentOnceTheBuffersAreDrained', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.enqueue(record({ message: 'once' }));
    archive.flush();
    archive.flush();
    expect(archive.readSession('session-a')).toHaveLength(1);
  });

  it('enqueueHuman_buffersLinesUntilFlush', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.enqueueHuman('line one\n');
    archive.enqueueHuman('line two\n');
    expect(existsSync(join(dir, 'studio.log'))).toBe(false);
    archive.flush();
    expect(readFileSync(join(dir, 'studio.log'), 'utf8')).toBe('line one\nline two\n');
  });

  it('appendHuman_appendsToStudioLog', () => {
    const archive: LogArchive = new LogArchive(dir);
    archive.appendHuman('line one\n');
    archive.appendHuman('line two\n');
    expect(readFileSync(join(dir, 'studio.log'), 'utf8')).toBe('line one\nline two\n');
  });

  it('appendHuman_rotatesWhenTheSizeCapIsCrossed', () => {
    const archive: LogArchive = new LogArchive(dir, 10, 3);
    archive.appendHuman('12345\n');
    archive.appendHuman('67890\n');
    expect(existsSync(join(dir, 'studio.1.log'))).toBe(true);
    expect(readFileSync(join(dir, 'studio.1.log'), 'utf8')).toBe('12345\n');
    expect(readFileSync(join(dir, 'studio.log'), 'utf8')).toBe('67890\n');
  });
});

describe('LogArchive retention', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'log-retention-'));
    fs.mkdirSync(path.join(directory, 'sessions'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Writes a session file, last touched a number of days ago.
   * @param name The session's id.
   * @param days How many days ago.
   */
  function session(name: string, days: number): void {
    const file: string = path.join(directory, 'sessions', `${name}.jsonl`);
    fs.writeFileSync(file, '{}\n');
    const when: Date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    fs.utimesSync(file, when, when);
  }

  it('pruneSessions_deletesWhatIsOlderThanTheDays_andNeverTheCurrentSession', () => {
    session('old', 40);
    session('recent', 5);
    session('current', 100);

    const deleted: number = new LogArchive(directory).pruneSessions(30, 'current');

    expect(deleted).toBe(1);
    expect(fs.readdirSync(path.join(directory, 'sessions')).sort()).toEqual([
      'current.jsonl',
      'recent.jsonl',
    ]);
  });

  it('setRotation_deletesCopiesPastTheNewCount', () => {
    for (const index of [1, 2, 3, 4]) {
      fs.writeFileSync(path.join(directory, `studio.${index}.log`), 'x');
    }

    new LogArchive(directory).setRotation(1024, 2);

    expect(
      fs
        .readdirSync(directory)
        .filter((name: string) => name.endsWith('.log'))
        .sort(),
    ).toEqual(['studio.1.log', 'studio.2.log']);
  });
});

describe('LogArchive.relocate', () => {
  it('writesWhatIsQueued_andPrunes_inTheNewDirectory_andLeavesTheOldAlone', () => {
    const first: string = fs.mkdtempSync(path.join(os.tmpdir(), 'log-first-'));
    const second: string = fs.mkdtempSync(path.join(os.tmpdir(), 'log-second-'));
    fs.mkdirSync(path.join(first, 'sessions'));
    fs.mkdirSync(path.join(second, 'sessions'));
    const stale: Date = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    for (const directory of [first, second]) {
      const file: string = path.join(directory, 'sessions', 'old.jsonl');
      fs.writeFileSync(file, '{}\n');
      fs.utimesSync(file, stale, stale);
    }
    const archive: LogArchive = new LogArchive(first);

    archive.enqueueHuman('line\n');
    archive.relocate(second);
    archive.flush();
    archive.pruneSessions(30, 'current');

    expect(fs.existsSync(path.join(first, 'studio.log'))).toBe(false);
    expect(fs.existsSync(path.join(second, 'studio.log'))).toBe(true);
    expect(fs.readdirSync(path.join(first, 'sessions'))).toEqual(['old.jsonl']);
    expect(fs.readdirSync(path.join(second, 'sessions'))).toEqual([]);
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
});
