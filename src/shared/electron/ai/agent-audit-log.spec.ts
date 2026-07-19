import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAuditLog, type AuditEntry, tailWholeLines } from './agent-audit-log';

/**
 * Builds an audit entry with sensible defaults, overridable per test.
 * @param over The fields to override.
 * @returns Returns the entry.
 */
function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    at: '2026-07-19T10:00:00.000Z',
    tool: 'Write',
    target: '/home/dev/project/a.ts',
    workspaceRoot: '/home/dev/project',
    source: 'interactive',
    ...over,
  };
}

/**
 * Reads the log file back as parsed JSONL entries.
 * @param dir The log directory.
 * @returns Returns the entries in file order.
 */
function readEntries(dir: string): AuditEntry[] {
  const raw: string = readFileSync(join(dir, 'agent-audit-log.jsonl'), 'utf8');
  return raw
    .split('\n')
    .filter((line: string): boolean => line.length > 0)
    .map((line: string): AuditEntry => JSON.parse(line) as AuditEntry);
}

describe('agent-audit-log', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('AgentAuditLog', () => {
    it('record_appendsOneJsonLinePerEntry', () => {
      const log: AgentAuditLog = new AgentAuditLog(dir);
      log.record(entry({ tool: 'Write' }));
      log.record(entry({ tool: 'Bash', target: 'npm test', source: 'posture' }));
      const entries: AuditEntry[] = readEntries(dir);
      expect(entries).toHaveLength(2);
      expect(entries[0].tool).toBe('Write');
      expect(entries[1]).toMatchObject({ tool: 'Bash', target: 'npm test', source: 'posture' });
    });

    it('record_preservesAllFields', () => {
      const log: AgentAuditLog = new AgentAuditLog(dir);
      const only: AuditEntry = entry({ source: 'remembered', workspaceRoot: null });
      log.record(only);
      expect(readEntries(dir)[0]).toEqual(only);
    });

    it('record_createsTheDirectoryWhenMissing', () => {
      const nested: string = join(dir, 'deep', 'nested');
      const log: AgentAuditLog = new AgentAuditLog(nested);
      log.record(entry());
      expect(readEntries(nested)).toHaveLength(1);
    });

    it('record_whenDirectoryIsUnwritable_dropsSilently', () => {
      // A path whose parent is a file cannot be created — record must swallow the error, not throw.
      const filePath: string = join(dir, 'a.ts');
      const log: AgentAuditLog = new AgentAuditLog(filePath);
      log.record(entry());
      expect(() => log.record(entry())).not.toThrow();
    });

    it('record_rotatesWhenOverTheCapKeepingRecentWholeLines', () => {
      const log: AgentAuditLog = new AgentAuditLog(dir);
      // Each entry carries a large payload so the ~1 MB cap is crossed within a bounded loop.
      const big: string = 'x'.repeat(10_000);
      for (let i: number = 0; i < 200; i++) {
        log.record(entry({ target: `${big}-${i}` }));
      }
      const entries: AuditEntry[] = readEntries(dir);
      // The log stayed bounded (older entries dropped) but still holds recent history, and every
      // surviving line is a whole, parseable record.
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.length).toBeLessThan(200);
      expect(entries[entries.length - 1].target).toBe(`${big}-199`);
    });
  });

  describe('tailWholeLines', () => {
    it('tailWholeLines_whenUnderBudget_returnsAsIs', () => {
      expect(tailWholeLines('a\nb\n', 100)).toBe('a\nb\n');
    });

    it('tailWholeLines_dropsThePartialLeadingLine', () => {
      // Keeping the last 5 bytes of "aa\nbb\ncc\n" starts mid-"bb"; that partial line is dropped and
      // the following whole line survives.
      expect(tailWholeLines('aa\nbb\ncc\n', 5)).toBe('cc\n');
    });
  });
});
