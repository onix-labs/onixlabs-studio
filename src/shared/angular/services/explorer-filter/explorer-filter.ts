import { computed, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Names what an explorer can be narrowed to: files version control sees as changed, or files with
 * problems of a severity.
 */
export type ExplorerFilterKind = 'changes' | 'error' | 'warning' | 'info' | 'hint';

/**
 * Lists the kinds an explorer's filter offers, in the order its menu lists them, with their labels.
 */
export const EXPLORER_FILTER_KINDS: readonly {
  readonly kind: ExplorerFilterKind;
  readonly label: string;
}[] = [
  { kind: 'changes', label: 'Show Differences' },
  { kind: 'error', label: 'Show Errors' },
  { kind: 'warning', label: 'Show Warnings' },
  { kind: 'info', label: 'Show Info' },
  { kind: 'hint', label: 'Show Hints' },
];

/**
 * Holds what an explorer is narrowed to: the kinds ticked in its filter, additive — a file matching
 * any of them shows — and none ticked showing everything. Remembered across restarts under one
 * storage key per explorer; a choice remembered under the explorer's older Show Changed Files Only
 * switch (#1053) carries over as Show Differences.
 */
export class ExplorerFilter {
  /**
   * Holds the kinds ticked.
   */
  private readonly selectedState: WritableSignal<ReadonlySet<ExplorerFilterKind>>;

  /**
   * Gets the kinds ticked.
   */
  public readonly selected: Signal<ReadonlySet<ExplorerFilterKind>>;

  /**
   * Gets whether anything is ticked.
   */
  public readonly active: Signal<boolean>;

  /**
   * Initializes a new instance of the {@link ExplorerFilter} class from what was remembered.
   * @param key The storage key the choice is remembered under.
   * @param legacyKey The key the explorer's Show Changed Files Only switch was remembered under.
   */
  public constructor(
    private readonly key: string,
    legacyKey: string,
  ) {
    this.selectedState = signal<ReadonlySet<ExplorerFilterKind>>(read(key, legacyKey));
    this.selected = this.selectedState.asReadonly();
    this.active = computed((): boolean => this.selectedState().size > 0);
  }

  /**
   * Ticks a kind, or unticks it, and remembers the choice.
   * @param kind The kind.
   */
  public toggle(kind: ExplorerFilterKind): void {
    this.selectedState.update(
      (current: ReadonlySet<ExplorerFilterKind>): ReadonlySet<ExplorerFilterKind> => {
        const next: Set<ExplorerFilterKind> = new Set<ExplorerFilterKind>(current);
        if (!next.delete(kind)) {
          next.add(kind);
        }
        return next;
      },
    );
    this.remember();
  }

  /**
   * Unticks a kind, if ticked, and remembers the choice.
   * @param kind The kind.
   */
  public clear(kind: ExplorerFilterKind): void {
    if (!this.selectedState().has(kind)) {
      return;
    }
    this.toggle(kind);
  }

  /**
   * Remembers the kinds ticked, quietly when storage is unavailable.
   */
  private remember(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.selectedState()]));
    } catch {
      // Not remembered; the filter still works for this session.
    }
  }
}

/**
 * Reads the kinds remembered for an explorer: its own list, or — never having had one — Show
 * Differences where its older switch was on.
 * @param key The storage key.
 * @param legacyKey The older switch's key.
 * @returns Returns the kinds.
 */
function read(key: string, legacyKey: string): ReadonlySet<ExplorerFilterKind> {
  try {
    const stored: string | null = localStorage.getItem(key);
    if (stored !== null) {
      const parsed: unknown = JSON.parse(stored);
      return new Set<ExplorerFilterKind>(
        Array.isArray(parsed)
          ? parsed.filter((kind: unknown): kind is ExplorerFilterKind =>
              EXPLORER_FILTER_KINDS.some(
                (entry: { readonly kind: ExplorerFilterKind }): boolean => entry.kind === kind,
              ),
            )
          : [],
      );
    }
    return new Set<ExplorerFilterKind>(
      localStorage.getItem(legacyKey) === 'true' ? ['changes'] : [],
    );
  } catch {
    return new Set<ExplorerFilterKind>();
  }
}
