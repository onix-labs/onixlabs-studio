import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  GpuProcessReading,
  GpuReading,
  ProcessesSnapshot,
  ProcessSample,
} from '@shared/api/system-monitor-channels';

/**
 * The most snapshots a process's history holds: two minutes at the listing's two-second pace.
 */
export const PROCESS_HISTORY: number = 60;

/**
 * Describes one process's recent readings, oldest first, for its graphs.
 */
export interface ProcessHistory {
  /**
   * Gets the CPU share history (percent of the machine).
   */
  readonly cpu: readonly number[];

  /**
   * Gets the resident memory history (bytes).
   */
  readonly memory: readonly number[];

  /**
   * Gets the GPU share history (percent of the GPU), 0 for each listing taken while the GPU was not
   * read per process.
   */
  readonly gpu: readonly number[];
}

/**
 * Describes the chosen process: as it was last listed, its history, and whether it is still listed.
 */
export interface ChosenProcess {
  /**
   * Gets the process as it was last listed.
   */
  readonly process: ProcessSample;

  /**
   * Gets its history, frozen once it stops being listed.
   */
  readonly history: ProcessHistory;

  /**
   * Gets whether the latest snapshot still lists it. A process stops being listed when it exits, or
   * when it is no longer among the busiest (Studio's own are always listed).
   */
  readonly listed: boolean;
}

/**
 * The history of a process not seen yet.
 */
const EMPTY_HISTORY: ProcessHistory = { cpu: [], memory: [], gpu: [] };

/**
 * Holds one System Monitor view's process listing: the latest snapshot, a short history per process so
 * a chosen one can be graphed, and which one is chosen. Provided by the view; the view feeds it
 * snapshots through {@link accept} while the Processes tab is on screen.
 *
 * A process's history is kept only while it appears in the listing: once it exits (or drops out of the
 * busiest), its history goes, so the map never outgrows the listing. The chosen process is the
 * exception: it stays chosen, frozen at its last reading and marked no longer listed, so a short-lived
 * process does not vanish from under the user the moment it ends. A pid reused by a new process starts
 * a fresh history, since its name will differ.
 */
@Service({ autoProvided: false })
export class SystemMonitorProcesses {
  /**
   * Holds the latest snapshot, or null before the first arrives.
   */
  public readonly snapshot: WritableSignal<ProcessesSnapshot | null> =
    signal<ProcessesSnapshot | null>(null);

  /**
   * Holds each listed process's history, by pid.
   */
  private readonly histories: WritableSignal<ReadonlyMap<number, ProcessHistory>> = signal<
    ReadonlyMap<number, ProcessHistory>
  >(new Map<number, ProcessHistory>());

  /**
   * Holds each process's share of the GPU from the latest GPU reading, by pid, or null while no GPU
   * reading that names processes has arrived.
   */
  public readonly gpuShares: WritableSignal<ReadonlyMap<number, number> | null> =
    signal<ReadonlyMap<number, number> | null>(null);

  /**
   * Gets every listed process's history, by pid.
   */
  public readonly allHistories: Signal<ReadonlyMap<number, ProcessHistory>> =
    this.histories.asReadonly();

  /**
   * Holds the name each history was recorded under, by pid, so a reused pid starts afresh.
   */
  private names: ReadonlyMap<number, string> = new Map<number, string>();

  /**
   * Holds the chosen process's pid, or null when none is chosen.
   */
  public readonly selectedPid: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets the processes in the latest snapshot.
   */
  public readonly processes: Signal<readonly ProcessSample[]> = computed(
    (): readonly ProcessSample[] => this.snapshot()?.processes ?? [],
  );

  /**
   * Holds the chosen process, or null when none is chosen.
   */
  private readonly chosen: WritableSignal<ChosenProcess | null> = signal<ChosenProcess | null>(
    null,
  );

  /**
   * Gets the chosen process, or null when none is chosen.
   */
  public readonly selected: Signal<ChosenProcess | null> = this.chosen.asReadonly();

  /**
   * Gets the chosen process's history, empty when none is chosen.
   */
  public readonly selectedHistory: Signal<ProcessHistory> = computed(
    (): ProcessHistory => this.chosen()?.history ?? EMPTY_HISTORY,
  );

  /**
   * Records one snapshot: it becomes the latest listing, each listed process's reading is appended to
   * its history, and the histories of processes no longer listed are dropped.
   * @param snapshot The snapshot to accept.
   */
  public accept(snapshot: ProcessesSnapshot): void {
    const previous: ReadonlyMap<number, ProcessHistory> = this.histories();
    const next: Map<number, ProcessHistory> = new Map<number, ProcessHistory>();
    const names: Map<number, string> = new Map<number, string>();
    const shares: ReadonlyMap<number, number> | null = this.gpuShares();
    for (const process of snapshot.processes) {
      const same: boolean = this.names.get(process.pid) === process.name;
      const history: ProcessHistory =
        (same ? previous.get(process.pid) : undefined) ?? EMPTY_HISTORY;
      next.set(process.pid, {
        cpu: [...history.cpu, process.cpuPercent].slice(-PROCESS_HISTORY),
        memory: [...history.memory, process.memoryBytes].slice(-PROCESS_HISTORY),
        gpu: [...history.gpu, shares?.get(process.pid) ?? 0].slice(-PROCESS_HISTORY),
      });
      names.set(process.pid, process.name);
    }
    this.names = names;
    this.histories.set(next);
    this.snapshot.set(snapshot);

    const chosen: ChosenProcess | null = this.chosen();
    if (chosen !== null) {
      const current: ProcessSample | undefined = snapshot.processes.find(
        (process: ProcessSample): boolean =>
          process.pid === chosen.process.pid && process.name === chosen.process.name,
      );
      this.chosen.set(
        current === undefined
          ? { ...chosen, listed: false }
          : { process: current, history: next.get(current.pid) ?? EMPTY_HISTORY, listed: true },
      );
    }
  }

  /**
   * Records the processes' shares of the GPU from a GPU reading, appended to their histories with the
   * next listing. A reading that names no process shares leaves the last ones in place.
   * @param reading The GPU reading.
   */
  public acceptGpu(reading: GpuReading): void {
    const processes: readonly GpuProcessReading[] = reading.processes;
    if (
      !processes.some((process: GpuProcessReading): boolean => process.gpuPercent !== undefined)
    ) {
      return;
    }
    this.gpuShares.set(
      new Map<number, number>(
        processes.map((process: GpuProcessReading): [number, number] => [
          process.pid,
          process.gpuPercent ?? 0,
        ]),
      ),
    );
  }

  /**
   * Chooses a process to graph, or clears the choice.
   * @param pid The process's pid, or null to clear.
   */
  public select(pid: number | null): void {
    const process: ProcessSample | undefined =
      pid === null
        ? undefined
        : this.processes().find((candidate: ProcessSample): boolean => candidate.pid === pid);
    this.selectedPid.set(process === undefined ? null : process.pid);
    this.chosen.set(
      process === undefined
        ? null
        : {
            process,
            history: this.histories().get(process.pid) ?? EMPTY_HISTORY,
            listed: true,
          },
    );
  }
}
