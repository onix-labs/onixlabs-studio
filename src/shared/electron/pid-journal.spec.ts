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

/**
 * Builds a journal entry stamped with an owning instance's identity.
 * @param pid The child pid.
 * @param comm The child's executable base name.
 * @param owner The owning instance's pid, executable base name, and start time.
 * @returns Returns the owned entry.
 */
function owned(
  pid: number,
  comm: string,
  owner: { pid: number; comm: string; startTimeMs: number },
): JournalEntry {
  return {
    pid,
    kind: 'agent',
    comm,
    spawnTimeMs: 1000,
    ownerPid: owner.pid,
    ownerComm: owner.comm,
    ownerStartTimeMs: owner.startTimeMs,
  };
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

  it('reapStale_sparesChildrenOfAStillLiveOwner_andKeepsThemJournalled', async () => {
    // A second instance (a dev build launched from an installed Studio) starting against the same
    // userData must not kill the first instance's live children — its language servers, terminals,
    // and Claude Code agent. Every child here is owned by pid 999, which is still alive.
    const store: MemoryStore = new MemoryStore();
    store.text = JSON.stringify([
      owned(20, 'Microsoft.CodeAnalysis.LanguageServer', { pid: 999, comm: 'Electron', startTimeMs: 5000 }),
      owned(21, 'node', { pid: 999, comm: 'Electron', startTimeMs: 5000 }),
    ]);
    const killed: number[] = [];
    const probes: Map<number, ProcessProbe | null> = new Map<number, ProcessProbe | null>([
      [20, { comm: 'Microsoft.CodeAnalysis.LanguageServer', startTimeMs: 2000 }], // child alive...
      [21, { comm: 'node', startTimeMs: 2000 }], // ...but owner is alive, so both are spared
      [999, { comm: 'Electron', startTimeMs: 5000 }], // the owning instance is still running
    ]);
    const journal: PidJournal = new PidJournal(
      store,
      (pid: number): Promise<ProcessProbe | null> => Promise.resolve(probes.get(pid) ?? null),
      (pid: number): void => {
        killed.push(pid);
      },
      { pid: 1234, comm: 'Electron', startTimeMs: 60_000 },
    );

    const reaped: number = await journal.reapStale();

    expect(reaped).toBe(0);
    expect(killed).toEqual([]);
    // The spared children stay journalled so their own (live) owner can reap them later.
    expect(parseJournal(store.text).map((e: JournalEntry): number => e.pid).sort()).toEqual([20, 21]);
  });

  it('reapStale_reapsChildrenWhoseOwnerIsGone', async () => {
    // The owning instance (pid 998) is dead, so its surviving children are genuine orphans and reaped.
    const store: MemoryStore = new MemoryStore();
    store.text = JSON.stringify([
      owned(30, 'Microsoft.CodeAnalysis.LanguageServer', { pid: 998, comm: 'Electron', startTimeMs: 5000 }),
    ]);
    const killed: number[] = [];
    const probes: Map<number, ProcessProbe | null> = new Map<number, ProcessProbe | null>([
      [30, { comm: 'Microsoft.CodeAnalysis.LanguageServer', startTimeMs: 2000 }], // child alive
      [998, null], // owner gone
    ]);
    const journal: PidJournal = new PidJournal(
      store,
      (pid: number): Promise<ProcessProbe | null> => Promise.resolve(probes.get(pid) ?? null),
      (pid: number): void => {
        killed.push(pid);
      },
      { pid: 1234, comm: 'Electron', startTimeMs: 60_000 },
    );

    const reaped: number = await journal.reapStale();

    expect(reaped).toBe(1);
    expect(killed).toEqual([30]);
  });

  it('reapStale_reapsChildrenWhoseOwnerPidWasRecycled', async () => {
    // The owner pid resolves to a different, unrelated process now — the original instance is gone —
    // so its children are orphans despite the pid being live.
    const store: MemoryStore = new MemoryStore();
    store.text = JSON.stringify([
      owned(40, 'clangd', { pid: 997, comm: 'Electron', startTimeMs: 5000 }),
    ]);
    const killed: number[] = [];
    const probes: Map<number, ProcessProbe | null> = new Map<number, ProcessProbe | null>([
      [40, { comm: 'clangd', startTimeMs: 2000 }],
      [997, { comm: 'bash', startTimeMs: 9000 }], // pid recycled: not the owning Studio
    ]);
    const journal: PidJournal = new PidJournal(
      store,
      (pid: number): Promise<ProcessProbe | null> => Promise.resolve(probes.get(pid) ?? null),
      (pid: number): void => {
        killed.push(pid);
      },
      { pid: 1234, comm: 'Electron', startTimeMs: 60_000 },
    );

    expect(await journal.reapStale()).toBe(1);
    expect(killed).toEqual([40]);
  });

  it('register_stampsTheOwningInstanceIdentity', () => {
    const store: MemoryStore = new MemoryStore();
    const journal: PidJournal = new PidJournal(store, undefined, undefined, {
      pid: 4321,
      comm: 'Electron',
      startTimeMs: 7000,
    });

    journal.register(55, 'agent', '/opt/homebrew/bin/claude');

    const recorded: JournalEntry = parseJournal(store.text)[0];
    expect(recorded.ownerPid).toBe(4321);
    expect(recorded.ownerComm).toBe('Electron');
    expect(recorded.ownerStartTimeMs).toBe(7000);
  });
});
