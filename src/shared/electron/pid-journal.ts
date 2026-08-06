import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { signalProcessTree } from './process-tree';

/**
 * A durable journal of the long-lived child processes the application has spawned (language servers,
 * terminals, debug adapters, agent CLIs). Nothing in the application runs when the main process is
 * force-killed — no `will-quit`, no signal handler — so the only way to clean up after one is to
 * remember what was spawned and reap the survivors at the NEXT startup. Every registration is
 * persisted synchronously (a crash can come at any moment), and reaping verifies a recorded pid still
 * belongs to the recorded process — same executable name, same start time — before killing, so a
 * recycled pid is never signalled.
 */

/**
 * Runs a child process and resolves with its output.
 */
const execFileAsync: (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * How far apart, in milliseconds, a recorded spawn time and a probed process start time may lie and
 * still be considered the same process. Process start times are reported at second granularity and
 * the recording happens moments after the spawn, so a generous window avoids false negatives without
 * meaningfully risking pid-reuse collisions (which would also need a matching executable name).
 */
const START_TIME_TOLERANCE_MS: number = 15_000;

/**
 * A journal record: one spawned child that may need reaping after a force-kill.
 */
export interface JournalEntry {
  /**
   * Gets the child's process identifier (its process-group id when spawned detached).
   */
  readonly pid: number;

  /**
   * Gets what kind of child this is (`lsp`, `terminal`, `debug`, `agent`), for diagnostics.
   */
  readonly kind: string;

  /**
   * Gets the executable's base name, used to verify the pid still belongs to this process.
   */
  readonly comm: string;

  /**
   * Gets when the child was spawned, in epoch milliseconds.
   */
  readonly spawnTimeMs: number;

  /**
   * Gets the process id of the application instance that spawned this child, or undefined for a legacy
   * entry written before ownership was recorded. A child whose owner is still alive is not an orphan —
   * another instance is running against this same userData — so {@link PidJournal.reapStale} leaves it
   * be rather than killing a live instance's work.
   */
  readonly ownerPid?: number;

  /**
   * Gets the owning instance's executable base name, used with {@link ownerStartTimeMs} to confirm the
   * owner pid still belongs to that instance (rather than a recycled pid) before sparing the child.
   */
  readonly ownerComm?: string;

  /**
   * Gets when the owning instance started, in epoch milliseconds.
   */
  readonly ownerStartTimeMs?: number;
}

/**
 * Identifies the application instance that owns the children it spawns: its process id, executable
 * base name, and start time. Stamped onto every journal entry so a later run can tell a dead run's
 * orphans (safe to reap) from another live instance's working children (must be spared).
 */
export interface OwnerIdentity {
  /**
   * Gets the owning instance's process id.
   */
  readonly pid: number;

  /**
   * Gets the owning instance's executable base name.
   */
  readonly comm: string;

  /**
   * Gets the owning instance's start time in epoch milliseconds.
   */
  readonly startTimeMs: number;
}

/**
 * Resolves the identity of the current application instance, stamped onto the children it spawns. The
 * start time is derived from the process uptime; second-level precision is ample against the reap-time
 * tolerance.
 * @returns Returns this instance's owner identity.
 */
export function currentOwner(): OwnerIdentity {
  return {
    pid: process.pid,
    comm: path.basename(process.execPath),
    startTimeMs: Date.now() - Math.round(process.uptime() * 1000),
  };
}

/**
 * What a probe learned about a live process, compared against a journal entry before reaping.
 */
export interface ProcessProbe {
  /**
   * Gets the process's executable base name.
   */
  readonly comm: string;

  /**
   * Gets the process's start time in epoch milliseconds, or null when the platform withheld it.
   */
  readonly startTimeMs: number | null;
}

/**
 * Parses persisted journal text, tolerating a missing, corrupt, or partially-written file — a crash
 * can interrupt anything, and a bad journal must never break startup.
 * @param text The persisted text, or null when the journal does not exist.
 * @returns Returns the well-formed entries.
 */
export function parseJournal(text: string | null): JournalEntry[] {
  if (text === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (candidate: unknown): candidate is JournalEntry =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as JournalEntry).pid === 'number' &&
      typeof (candidate as JournalEntry).kind === 'string' &&
      typeof (candidate as JournalEntry).comm === 'string' &&
      typeof (candidate as JournalEntry).spawnTimeMs === 'number',
  );
}

/**
 * Determines whether a probed live process is the one a journal entry recorded: the executable base
 * names must match (case-insensitively — Windows reports `.exe` casing loosely), and when the probe
 * carries a start time it must lie within tolerance of the recorded spawn time. A pid recycled by the
 * OS fails one check or the other.
 * @param entry The journal entry.
 * @param probe The probe of whatever currently owns the pid.
 * @returns Returns true when the live process is the recorded child.
 */
export function matchesEntry(entry: JournalEntry, probe: ProcessProbe): boolean {
  const recorded: string = entry.comm.toLowerCase();
  const probed: string = probe.comm.toLowerCase();
  if (recorded !== probed) {
    return false;
  }
  if (probe.startTimeMs === null) {
    return true;
  }
  return Math.abs(probe.startTimeMs - entry.spawnTimeMs) <= START_TIME_TOLERANCE_MS;
}

/**
 * The journal itself: registrations persist synchronously, and {@link reapStale} kills verified
 * survivors from a previous run. The store, probe, and killer are injectable for testing; the
 * defaults use the real filesystem, `ps`/`tasklist`, and a SIGKILL of the process group.
 */
export class PidJournal {
  /**
   * Holds the persistence adapter.
   */
  private readonly store: { load(): string | null; save(text: string): void };

  /**
   * Holds the probe resolving what currently owns a pid.
   */
  private readonly probe: (pid: number) => Promise<ProcessProbe | null>;

  /**
   * Holds the killer applied to verified stale entries.
   */
  private readonly killer: (pid: number) => void;

  /**
   * Holds the identity of this instance, stamped onto every child it registers.
   */
  private readonly owner: OwnerIdentity;

  /**
   * Holds the live entries of this run, keyed by pid.
   */
  private readonly entries: Map<number, JournalEntry> = new Map<number, JournalEntry>();

  /**
   * Initializes a new instance of the {@link PidJournal} class.
   * @param store The persistence adapter.
   * @param probe The process probe, defaulting to `ps`/`tasklist`.
   * @param killer The stale-entry killer, defaulting to SIGKILL of the process group.
   * @param owner This instance's identity, stamped onto the children it registers.
   */
  public constructor(
    store: { load(): string | null; save(text: string): void },
    probe: (pid: number) => Promise<ProcessProbe | null> = probeProcess,
    killer: (pid: number) => void = (pid: number): void => signalProcessTree(pid, 'SIGKILL'),
    owner: OwnerIdentity = currentOwner(),
  ) {
    this.store = store;
    this.probe = probe;
    this.killer = killer;
    this.owner = owner;
  }

  /**
   * Records a spawned child, persisting immediately so a force-kill directly after the spawn still
   * leaves a trace to reap by.
   * @param pid The child's process identifier.
   * @param kind What kind of child this is.
   * @param command The command the child was spawned from (its base name is recorded).
   */
  public register(pid: number | undefined, kind: string, command: string): void {
    if (pid === undefined || pid <= 0) {
      return;
    }
    this.entries.set(pid, {
      pid,
      kind,
      comm: path.basename(command),
      spawnTimeMs: Date.now(),
      ownerPid: this.owner.pid,
      ownerComm: this.owner.comm,
      ownerStartTimeMs: this.owner.startTimeMs,
    });
    this.persist();
  }

  /**
   * Removes a child that exited or was killed, persisting the shrunken journal.
   * @param pid The child's process identifier.
   */
  public unregister(pid: number | undefined): void {
    if (pid === undefined || !this.entries.delete(pid)) {
      return;
    }
    this.persist();
  }

  /**
   * Reaps the survivors of a previous run: loads the persisted journal, verifies each recorded pid
   * still belongs to the recorded process, kills the ones that do, and resets the journal to this
   * run's (empty) state. Called once at startup, before anything new is spawned.
   * @returns Returns the number of processes reaped.
   */
  public async reapStale(): Promise<number> {
    const stale: JournalEntry[] = parseJournal(this.loadSafely());
    let reaped: number = 0;
    for (const entry of stale) {
      // A child whose owning instance is still alive is not an orphan: another Studio is running
      // against this same userData — the common case being a development build launched from an
      // installed Studio while developing Studio itself — and this entry is that instance's working
      // language server, terminal, or Claude Code agent. Reaping it would SIGKILL a running
      // instance's work, so spare it and keep it journalled for its own owner to reap later.
      if (await this.ownerAlive(entry)) {
        if (!this.entries.has(entry.pid)) {
          this.entries.set(entry.pid, entry);
        }
        continue;
      }
      const probe: ProcessProbe | null = await this.probe(entry.pid).catch((): null => null);
      if (probe !== null && matchesEntry(entry, probe)) {
        this.killer(entry.pid);
        reaped += 1;
      }
    }
    this.persist();
    return reaped;
  }

  /**
   * Determines whether the instance that spawned a journalled child is still running, so its children
   * are spared from reaping. Legacy entries carry no owner and are treated as ownerless (reaped as
   * before). The recorded owner pid is probed and verified against the recorded executable name and
   * start time so a pid the OS has since recycled does not masquerade as the still-live owner.
   * @param entry The journal entry whose owner is checked.
   * @returns Returns true when the owning instance is still alive.
   */
  private async ownerAlive(entry: JournalEntry): Promise<boolean> {
    if (
      typeof entry.ownerPid !== 'number' ||
      typeof entry.ownerComm !== 'string' ||
      typeof entry.ownerStartTimeMs !== 'number'
    ) {
      return false;
    }
    const probe: ProcessProbe | null = await this.probe(entry.ownerPid).catch((): null => null);
    if (probe === null) {
      return false;
    }
    return matchesEntry(
      { pid: entry.ownerPid, kind: 'owner', comm: entry.ownerComm, spawnTimeMs: entry.ownerStartTimeMs },
      probe,
    );
  }

  /**
   * Loads the persisted journal, treating an unreadable store as empty.
   * @returns Returns the persisted text, or null.
   */
  private loadSafely(): string | null {
    try {
      return this.store.load();
    } catch {
      return null;
    }
  }

  /**
   * Persists the current entries, ignoring write failures — the journal is a safety net, and a full
   * disk must not break spawning.
   */
  private persist(): void {
    try {
      this.store.save(JSON.stringify([...this.entries.values()]));
    } catch {
      // Best-effort persistence.
    }
  }
}

/**
 * Probes what currently owns a pid: its executable base name and, where available, its start time.
 * @param pid The process identifier to probe.
 * @returns Returns the probe, or null when no such process exists.
 */
async function probeProcess(pid: number): Promise<ProcessProbe | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout }: { stdout: string } = await execFileAsync('tasklist', [
        '/FI',
        `PID eq ${pid}`,
        '/FO',
        'CSV',
        '/NH',
      ]);
      const match: RegExpExecArray | null = /^"([^"]+)"/.exec(stdout.trim());
      return match === null ? null : { comm: match[1], startTimeMs: null };
    } catch {
      return null;
    }
  }
  try {
    const { stdout: comm }: { stdout: string } = await execFileAsync('ps', [
      '-p',
      String(pid),
      '-o',
      'comm=',
    ]);
    const name: string = comm.trim();
    if (name.length === 0) {
      return null;
    }
    const { stdout: started }: { stdout: string } = await execFileAsync('ps', [
      '-p',
      String(pid),
      '-o',
      'lstart=',
    ]);
    const startTimeMs: number = Date.parse(started.trim());
    return {
      comm: path.basename(name),
      startTimeMs: Number.isNaN(startTimeMs) ? null : startTimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Creates the on-disk persistence adapter for the journal.
 * @param filePath The absolute path of the journal file.
 * @returns Returns the store.
 */
export function createFileJournalStore(filePath: string): {
  load(): string | null;
  save(text: string): void;
} {
  return {
    load: (): string | null => {
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
    },
    save: (text: string): void => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, text, 'utf8');
    },
  };
}

/**
 * Holds the installed journal instance, when the application has one.
 */
let installed: PidJournal | null = null;

/**
 * Installs the application's journal instance, making it reachable from every spawning subsystem
 * without threading it through each constructor.
 * @param journal The journal to install.
 */
export function installPidJournal(journal: PidJournal): void {
  installed = journal;
}

/**
 * Gets the installed journal, or null outside the packaged/main-process context (tests, tooling).
 * @returns Returns the journal, or null.
 */
export function pidJournal(): PidJournal | null {
  return installed;
}
