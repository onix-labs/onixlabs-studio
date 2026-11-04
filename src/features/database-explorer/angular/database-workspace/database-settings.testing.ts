import { Signal, signal, WritableSignal } from '@angular/core';
import {
  DatabaseSelectAction,
  SETTINGS_DEFAULTS,
  SettingsKey,
  SettingsValues,
} from '@shared/angular/services/settings/settings-registry';

/**
 * Stands in for the Settings service in the Database Explorer's specs: every key at its registered
 * default, changed with {@link set}.
 */
export class DatabaseSettingsStandIn {
  private readonly values: Map<SettingsKey, WritableSignal<unknown>> = new Map<
    SettingsKey,
    WritableSignal<unknown>
  >();

  /**
   * Creates the stand-in.
   * @param databaseSelectAction The select-action signal the spec drives.
   */
  public constructor(public readonly databaseSelectAction: Signal<DatabaseSelectAction>) {}

  /**
   * Gets a setting's signal.
   * @param key The setting.
   * @returns Returns the signal.
   */
  public value<K extends SettingsKey>(key: K): Signal<SettingsValues[K]> {
    return this.writable(key);
  }

  /**
   * Reads a setting.
   * @param key The setting.
   * @returns Returns its value.
   */
  public get<K extends SettingsKey>(key: K): SettingsValues[K] {
    return this.writable(key)();
  }

  /**
   * Writes a setting.
   * @param key The setting.
   * @param value Its value.
   */
  public set<K extends SettingsKey>(key: K, value: SettingsValues[K]): void {
    this.writable(key).set(value);
  }

  /**
   * Gets a setting's signal, made from its default on first use.
   * @param key The setting.
   * @returns Returns the signal.
   */
  private writable<K extends SettingsKey>(key: K): WritableSignal<SettingsValues[K]> {
    let existing: WritableSignal<unknown> | undefined = this.values.get(key);
    if (existing === undefined) {
      existing = signal<unknown>(SETTINGS_DEFAULTS[key]);
      this.values.set(key, existing);
    }
    return existing as WritableSignal<SettingsValues[K]>;
  }
}
