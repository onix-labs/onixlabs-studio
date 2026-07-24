import { Service } from '@angular/core';

/**
 * Represents a small key/value persistence abstraction for user settings.
 *
 * The backend is `localStorage` for now; an Electron-backed store can replace the private accessors
 * later without affecting callers. Values are serialised as JSON, and every failure path (absent
 * storage, malformed JSON, quota errors) degrades to the caller's fallback rather than throwing, so
 * settings never break application start-up.
 */
@Service()
export class SettingsStore {
  /**
   * Reads and deserialises the value stored under the given key.
   * @param key The key to read.
   * @param fallback The value to return when the key is absent or cannot be deserialised.
   * @returns Returns the stored value, or the fallback.
   */
  public get<T>(key: string, fallback: T): T {
    const raw: string | null = this.read(key);
    if (raw === null) {
      return fallback;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Serialises and stores the given value under the given key.
   * @param key The key to write.
   * @param value The value to store.
   */
  public set<T>(key: string, value: T): void {
    this.write(key, JSON.stringify(value));
  }

  /**
   * Subscribes to changes ANOTHER window makes to the given key, so per-window state read once at
   * boot (the theme, the settings map) can follow live edits made elsewhere — a pop-out window
   * following the main window's appearance. The browser fires the `storage` event only in the
   * windows that did not perform the write, so a listener that re-reads and applies the value can
   * never echo the change back to its source.
   * @param key The key to watch.
   * @param listener Invoked after another window changes the key; re-read through {@link get}.
   * @returns Returns a function that removes the listener.
   */
  public onExternalChange(key: string, listener: () => void): () => void {
    if (typeof globalThis.addEventListener !== 'function') {
      return (): void => undefined;
    }
    const handler: (event: Event) => void = (event: Event): void => {
      if ((event as StorageEvent).key === key) {
        listener();
      }
    };
    globalThis.addEventListener('storage', handler);
    return (): void => globalThis.removeEventListener('storage', handler);
  }

  /**
   * Reads the raw string stored under the given key, returning null when storage is unavailable or
   * the key is absent.
   * @param key The key to read.
   * @returns Returns the raw stored string, or null.
   */
  private read(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Writes the given raw string under the given key, silently ignoring storage failures.
   * @param key The key to write.
   * @param value The raw string to store.
   */
  private write(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage is unavailable or full; settings persistence is best-effort, so swallow the error.
    }
  }
}
