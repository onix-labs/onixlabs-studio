import { effect, inject, Injector, Service, signal, WritableSignal } from '@angular/core';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';

/**
 * Holds the prefix every remembered value is stored under, so remembered state never collides with a
 * setting and can be found (or cleared) as one group.
 */
const KEY_PREFIX: string = 'studio.remembered.';

/**
 * Keeps the choices Studio remembers rather than asks for in Settings: what you last did with a
 * control (a toolbar toggle, a panel's filter, the window lock), either across launches or for this
 * session only.
 *
 * A remembered choice is not a setting. It has no page, no default to restore and no place in Import
 * or Export; it is simply how you left things. One service keeps them so the many "remember this"
 * changes in the settings epic (#1222) share one way of doing it, and each value is one signal any
 * number of views can share.
 */
@Service()
export class RememberedState {
  /**
   * Holds the store remembered-across-launches values are persisted in.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds the injector the persisting effects run in.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the signals handed out so far, by key, so every caller asking for a key shares one value.
   */
  private readonly signals: Map<string, WritableSignal<unknown>> = new Map<
    string,
    WritableSignal<unknown>
  >();

  /**
   * Gets a value remembered across launches: read from the store the first time it is asked for, and
   * written back whenever it changes.
   * @param key The value's stable name (for example `windowLock.locked`).
   * @param fallback The value used until one has been remembered.
   * @returns Returns the shared, writable value.
   */
  public acrossLaunches<T>(key: string, fallback: T): WritableSignal<T> {
    const existing: WritableSignal<unknown> | undefined = this.signals.get(key);
    if (existing !== undefined) {
      return existing as WritableSignal<T>;
    }
    const value: WritableSignal<T> = signal<T>(this.store.get<T>(KEY_PREFIX + key, fallback));
    this.signals.set(key, value);
    effect(
      (): void => {
        this.store.set<T>(KEY_PREFIX + key, value());
      },
      { injector: this.injector },
    );
    return value;
  }

  /**
   * Gets a value remembered for this session only: shared by every view that asks for it, and
   * forgotten when Studio quits.
   * @param key The value's stable name.
   * @param fallback The value used until one has been chosen.
   * @returns Returns the shared, writable value.
   */
  public forSession<T>(key: string, fallback: T): WritableSignal<T> {
    const existing: WritableSignal<unknown> | undefined = this.signals.get(key);
    if (existing !== undefined) {
      return existing as WritableSignal<T>;
    }
    const value: WritableSignal<T> = signal<T>(fallback);
    this.signals.set(key, value);
    return value;
  }
}
