import { Signal, signal, WritableSignal } from '@angular/core';

/**
 * An explorer's on/off choice that is not a setting: it stays as the user leaves it, across restarts,
 * under its own storage key.
 */
export class RememberedSwitch {
  /**
   * Holds whether the switch is on.
   */
  private readonly state: WritableSignal<boolean>;

  /**
   * Gets whether the switch is on.
   */
  public readonly on: Signal<boolean>;

  /**
   * Initializes a new instance of the {@link RememberedSwitch} class from what was remembered.
   * @param key The storage key the choice is remembered under.
   * @param initial Whether it is on before anything has been remembered.
   */
  public constructor(
    private readonly key: string,
    initial: boolean,
  ) {
    this.state = signal<boolean>(read(key, initial));
    this.on = this.state.asReadonly();
  }

  /**
   * Flips the switch and remembers the choice, quietly when storage is unavailable.
   */
  public toggle(): void {
    this.state.update((value: boolean): boolean => !value);
    try {
      localStorage.setItem(this.key, String(this.state()));
    } catch {
      // Not remembered; the switch still works for this session.
    }
  }
}

/**
 * Reads what was remembered under a key.
 * @param key The storage key.
 * @param initial The value when nothing was.
 * @returns Returns the value.
 */
function read(key: string, initial: boolean): boolean {
  try {
    const stored: string | null = localStorage.getItem(key);
    return stored === null ? initial : stored === 'true';
  } catch {
    return initial;
  }
}
