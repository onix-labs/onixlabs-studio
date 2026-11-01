import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Describes something that can be running work the user would lose by quitting: a workspace's runs
 * and builds, for one.
 */
export interface RunningWorkSource {
  /**
   * Gets how many items are running right now.
   */
  readonly count: Signal<number>;
}

/**
 * The set of running-work sources the quit flow consults, so Confirm Before Quitting can ask while
 * work is running. View-scoped sources (each workspace's build runner) register here for their
 * lifetime, as unsaved documents do with the unsaved-work registry.
 */
@Service()
export class RunningWork {
  /**
   * Holds the registered sources.
   */
  private readonly sources: WritableSignal<ReadonlySet<RunningWorkSource>> = signal<
    ReadonlySet<RunningWorkSource>
  >(new Set<RunningWorkSource>());

  /**
   * Gets how many items are running across every registered source.
   */
  public readonly count: Signal<number> = computed((): number =>
    [...this.sources()].reduce(
      (total: number, source: RunningWorkSource): number => total + source.count(),
      0,
    ),
  );

  /**
   * Registers a source for its lifetime.
   * @param source The source to include.
   * @returns Returns a function that unregisters it.
   */
  public register(source: RunningWorkSource): () => void {
    this.sources.update(
      (sources: ReadonlySet<RunningWorkSource>): ReadonlySet<RunningWorkSource> =>
        new Set<RunningWorkSource>([...sources, source]),
    );
    return (): void => {
      this.sources.update(
        (sources: ReadonlySet<RunningWorkSource>): ReadonlySet<RunningWorkSource> => {
          const next: Set<RunningWorkSource> = new Set<RunningWorkSource>(sources);
          next.delete(source);
          return next;
        },
      );
    };
  }
}
