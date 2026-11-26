import { inject, Service } from '@angular/core';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * Remembers the pixel sizes of splits' panes, by the split's key and the pane's id, so a new split
 * starts at the sizes last set under its key.
 *
 * Deliberately not reactive: each open split keeps its own sizes, and setting one never changes another
 * that is already open (#1561).
 */
@Service()
export class SplitSizes {
  /**
   * Holds the store sizes persist to.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Gets the size last set for a pane.
   * @param key The split's key.
   * @param paneId The pane's id.
   * @returns Returns the size in pixels, or null when none was set.
   */
  public get(key: string, paneId: string): number | null {
    return this.read(key)[paneId] ?? null;
  }

  /**
   * Remembers a pane's size, leaving the split's other panes as they were.
   * @param key The split's key.
   * @param paneId The pane's id.
   * @param size The size in pixels.
   */
  public set(key: string, paneId: string, size: number): void {
    this.store.set(SplitSizes.storeKey(key), { ...this.read(key), [paneId]: size });
  }

  /**
   * Reads a split's remembered sizes, passing over anything stored that is not a usable size.
   * @param key The split's key.
   * @returns Returns the sizes, by pane id.
   */
  private read(key: string): Readonly<Record<string, number>> {
    return Object.fromEntries(
      Object.entries(this.readObject(SplitSizes.storeKey(key))).filter(
        (entry: [string, unknown]): entry is [string, number] => isSize(entry[1]),
      ),
    );
  }

  /**
   * Reads a stored object.
   * @param storeKey The store key.
   * @returns Returns the object, empty when nothing usable is stored.
   */
  private readObject(storeKey: string): Readonly<Record<string, unknown>> {
    const raw: unknown = this.store.get<unknown>(storeKey, null);
    return raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? {}
      : (raw as Record<string, unknown>);
  }

  /**
   * Builds the persistence key for a split's key.
   * @param key The split's key.
   * @returns Returns the store key.
   */
  private static storeKey(key: string): string {
    return `split.${key}`;
  }
}

/**
 * Determines whether a stored value is a usable size.
 * @param value The value.
 * @returns Returns true for a positive, finite number.
 */
function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
