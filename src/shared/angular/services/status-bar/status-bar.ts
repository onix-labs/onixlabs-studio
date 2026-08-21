import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { StatusSegment } from './status-segment';

/**
 * Holds a registered owner's segments together with the priority that orders them against other
 * owners (lower priority renders first).
 */
interface OwnerEntry {
  /**
   * Gets the segments contributed by the owner.
   */
  readonly segments: readonly StatusSegment[];

  /**
   * Gets the priority that orders this owner against others (lower renders first).
   */
  readonly priority: number;
}

/**
 * Holds the status strip's **ambient** segments: app-wide state that is true no matter which tab is
 * in front, such as the count of running containers. Several owners contribute concurrently and are
 * merged in priority order, and the strip renders them at its end, alongside the language-server and
 * notification menus.
 *
 * This registry is deliberately not for a view's own status. A view's segments belong to its feature's
 * status component, which the strip mounts for the active tab and destroys on tab switch (see
 * `FeatureDescriptor.status`) — so they cannot outlive the view that means them. Publishing view state
 * here instead reintroduces exactly that bug: the owner key survives the view, and its segments strand
 * themselves over whatever tab the user opens next.
 */
@Service()
export class StatusBar {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds every owner's segments, keyed by owner identifier.
   */
  private readonly owners: WritableSignal<ReadonlyMap<string, OwnerEntry>> = signal<
    ReadonlyMap<string, OwnerEntry>
  >(new Map<string, OwnerEntry>());

  /**
   * Gets the merged ambient segments, ordered by owner priority.
   */
  public readonly segments: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] =>
      [...this.owners().values()]
        .sort((a: OwnerEntry, b: OwnerEntry): number => a.priority - b.priority)
        .flatMap((entry: OwnerEntry): readonly StatusSegment[] => entry.segments),
  );

  /**
   * Registers (or replaces) an owner's ambient segments.
   * @param ownerId The identifier of the contributing owner.
   * @param segments The segments the owner contributes.
   * @param priority The priority that orders this owner against others (lower renders first).
   */
  public contribute(ownerId: string, segments: readonly StatusSegment[], priority: number): void {
    this.owners.update(
      (current: ReadonlyMap<string, OwnerEntry>): ReadonlyMap<string, OwnerEntry> => {
        const next: Map<string, OwnerEntry> = new Map<string, OwnerEntry>(current);
        next.set(ownerId, { segments, priority });
        return next;
      },
    );
  }

  /**
   * Removes an owner's segments, so they no longer appear in the status strip.
   * @param ownerId The identifier of the owner to clear.
   */
  public clearOwner(ownerId: string): void {
    if (!this.owners().has(ownerId)) {
      return;
    }
    this.owners.update(
      (current: ReadonlyMap<string, OwnerEntry>): ReadonlyMap<string, OwnerEntry> => {
        const next: Map<string, OwnerEntry> = new Map<string, OwnerEntry>(current);
        next.delete(ownerId);
        return next;
      },
    );
    this.log.trace('StatusBar', `Cleared status contribution`, ownerId);
  }
}
