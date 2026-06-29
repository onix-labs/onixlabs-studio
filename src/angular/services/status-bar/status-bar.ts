import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Defines a single segment of contextual information shown in the status strip.
 */
export interface StatusSegment {
  /**
   * Gets the unique identifier of the segment.
   */
  readonly id: string;

  /**
   * Gets the text of the segment.
   */
  readonly text: string;

  /**
   * Gets the optional icon of the segment.
   */
  readonly icon?: Icon;
}

/**
 * Defines a single owner's contribution to the status strip: its leading and trailing segments.
 */
export interface StatusContribution {
  /**
   * Gets the leading (start-aligned) segments contributed by the owner.
   */
  readonly leading: readonly StatusSegment[];

  /**
   * Gets the trailing (end-aligned) segments contributed by the owner.
   */
  readonly trailing: readonly StatusSegment[];
}

/**
 * Holds a registered owner's contribution together with the priority that orders it against other
 * owners (lower priority renders first within each slot).
 */
interface OwnerEntry extends StatusContribution {
  /**
   * Gets the priority that orders this owner against others (lower renders first).
   */
  readonly priority: number;
}

/**
 * Represents the contextual status bar content. Multiple views ("owners") contribute leading and
 * trailing segments concurrently — for example the code editor (path, cursor, line-ending, encoding)
 * and the terminal (working directory) are visible at the same time when a terminal is docked in a
 * code tab. Contributions are merged in priority order rather than overwriting one another.
 */
@Service()
export class StatusBar {
  /**
   * Holds every owner's contribution, keyed by owner identifier.
   */
  private readonly owners: WritableSignal<ReadonlyMap<string, OwnerEntry>> = signal<
    ReadonlyMap<string, OwnerEntry>
  >(new Map<string, OwnerEntry>());

  /**
   * Gets the merged leading (start-aligned) status segments, ordered by owner priority.
   */
  public readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => this.collect((entry: OwnerEntry): readonly StatusSegment[] => entry.leading),
  );

  /**
   * Gets the merged trailing (end-aligned) status segments, ordered by owner priority.
   */
  public readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => this.collect((entry: OwnerEntry): readonly StatusSegment[] => entry.trailing),
  );

  /**
   * Registers (or replaces) an owner's status contribution.
   * @param ownerId The identifier of the contributing owner.
   * @param contribution The leading and trailing segments the owner contributes.
   * @param priority The priority that orders this owner against others (lower renders first).
   */
  public contribute(ownerId: string, contribution: StatusContribution, priority: number): void {
    this.owners.update((current: ReadonlyMap<string, OwnerEntry>): ReadonlyMap<string, OwnerEntry> => {
      const next: Map<string, OwnerEntry> = new Map<string, OwnerEntry>(current);
      next.set(ownerId, { ...contribution, priority });
      return next;
    });
  }

  /**
   * Removes an owner's contribution, so it no longer appears in the status strip.
   * @param ownerId The identifier of the owner to clear.
   */
  public clearOwner(ownerId: string): void {
    this.owners.update((current: ReadonlyMap<string, OwnerEntry>): ReadonlyMap<string, OwnerEntry> => {
      if (!current.has(ownerId)) {
        return current;
      }
      const next: Map<string, OwnerEntry> = new Map<string, OwnerEntry>(current);
      next.delete(ownerId);
      return next;
    });
  }

  /**
   * Flattens the registered owners' segments for one slot, ordered by ascending priority.
   * @param select Selects the leading or trailing segments from an owner entry.
   * @returns Returns the merged segments for the slot.
   */
  private collect(
    select: (entry: OwnerEntry) => readonly StatusSegment[],
  ): readonly StatusSegment[] {
    return [...this.owners().values()]
      .sort((a: OwnerEntry, b: OwnerEntry): number => a.priority - b.priority)
      .flatMap((entry: OwnerEntry): readonly StatusSegment[] => select(entry));
  }
}
