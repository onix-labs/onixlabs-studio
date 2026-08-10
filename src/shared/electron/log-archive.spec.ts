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
    const current: LogSession = { id: 'current', startedAt: '2999-01-01T00:00:00.000Z', current: true };
    const sessions: readonly LogSession[] = archive.sessions(current);
    expect(sessions[0]).toEqual(current);
    expect(sessions.some((session: LogSession): boolean => session.id === 'past-1')).toBe(true);
    expect(sessions.find((session: LogSession): boolean => session.id === 'past-1')?.current).toBe(false);
  });

  it('sessions_returnsOnlyTheCurrentWhenNoFilesExist', () => {
    const current: LogSession = { id: 'current', startedAt: '2026-08-10T00:00:00.000Z', current: true };
    expect(new LogArchive(dir).sessions(current)).toEqual([current]);
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
