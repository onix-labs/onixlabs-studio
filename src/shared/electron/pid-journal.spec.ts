import { JournalEntry, matchesEntry, parseJournal, PidJournal, ProcessProbe } from './pid-journal';

/**
 * An in-memory store the tests inspect.
 */
class MemoryStore {
  public text: string | null = null;
  public load(): string | null {
    return this.text;
  }
  public save(text: string): void {
    this.text = text;
  }
}

/**
 * Builds a journal entry.
 * @param pid The pid.
 * @param comm The executable base name.
 * @param spawnTimeMs The spawn time.
 * @returns Returns the entry.
 */
function entry(pid: number, comm: string, spawnTimeMs: number): JournalEntry {
  return { pid, kind: 'lsp', comm, spawnTimeMs };
}

describe('parseJournal', () => {
  it('missingCorruptOrPartialText_yieldsNoEntries', () => {
    expect(parseJournal(null)).toEqual([]);
    expect(parseJournal('')).toEqual([]);
    expect(parseJournal('{"pid": 1')).toEqual([]);
    expect(parseJournal('{"not":"an array"}')).toEqual([]);
  });

  it('wellFormedEntries_roundTrip_andMalformedOnesAreDropped', () => {
    const good: JournalEntry = entry(123, 'dotnet', 1000);
    const text: string = JSON.stringify([good, { pid: 'nope' }, null, 42]);
    expect(parseJournal(text)).toEqual([good]);
  });
});

describe('matchesEntry', () => {
  it('sameNameAndNearbyStartTime_matches', () => {
    const probe: ProcessProbe = { comm: 'dotnet', startTimeMs: 4000 };
    expect(matchesEntry(entry(1, 'dotnet', 1000), probe)).toBe(true);
  });

  it('differentExecutableName_isARecycledPid', () => {
    const probe: ProcessProbe = { comm: 'node', startTimeMs: 1000 };
    expect(matchesEntry(entry(1, 'dotnet', 1000), probe)).toBe(false);
  });

  it('distantStartTime_isARecycledPid', () => {
    const probe: ProcessProbe = { comm: 'dotnet', startTimeMs: 100_000 };
    expect(matchesEntry(entry(1, 'dotnet', 1000), probe)).toBe(false);
  });

  it('nameCasing_doesNotMatter', () => {
    const probe: ProcessProbe = { comm: 'DotNet.EXE', startTimeMs: null };
    expect(matchesEntry(entry(1, 'dotnet.exe', 1000), probe)).toBe(true);
  });

  it('withoutAProbedStartTime_theNameDecides', () => {
    expect(matchesEntry(entry(1, 'java', 1000), { comm: 'java', startTimeMs: null })).toBe(true);
  });
});

describe('PidJournal', () => {
  it('register_persistsImmediately_andUnregisterShrinksTheJournal', () => {
    const store: MemoryStore = new MemoryStore();
    const journal: PidJournal = new PidJournal(store);

    journal.register(42, 'lsp', '/usr/bin/roslyn/Microsoft.CodeAnalysis.LanguageServer');
    expect(parseJournal(store.text).map((e: JournalEntry): number => e.pid)).toEqual([42]);
    expect(parseJournal(store.text)[0].comm).toBe('Microsoft.CodeAnalysis.LanguageServer');

    journal.register(43, 'terminal', '/bin/zsh');
    journal.unregister(42);
    expect(parseJournal(store.text).map((e: JournalEntry): number => e.pid)).toEqual([43]);
  });

  it('register_withoutAPid_recordsNothing', () => {
    const store: MemoryStore = new MemoryStore();
    const journal: PidJournal = new PidJournal(store);
    journal.register(undefined, 'lsp', 'x');
    journal.register(0, 'lsp', 'x');
    expect(store.text).toBeNull();
  });

  it('reapStale_killsOnlyVerifiedSurvivors_andResetsTheJournal', async () => {
    const store: MemoryStore = new MemoryStore();
    store.text = JSON.stringify([
      entry(10, 'dotnet', 1000), // still the same process -> reaped
      entry(11, 'java', 1000), // pid now owned by something else -> spared
      entry(12, 'zsh', 1000), // process gone -> nothing to do
    ]);
    const killed: number[] = [];
    const probes: Map<number, ProcessProbe | null> = new Map<number, ProcessProbe | null>([
      [10, { comm: 'dotnet', startTimeMs: 2000 }],
      [11, { comm: 'totally-else', startTimeMs: 2000 }],
      [12, null],
    ]);
    const journal: PidJournal = new PidJournal(
      store,
      (pid: number): Promise<ProcessProbe | null> => Promise.resolve(probes.get(pid) ?? null),
      (pid: number): void => {
        killed.push(pid);
      },
    );

    const reaped: number = await journal.reapStale();

    expect(reaped).toBe(1);
    expect(killed).toEqual([10]);
    expect(parseJournal(store.text)).toEqual([]);
  });
});
