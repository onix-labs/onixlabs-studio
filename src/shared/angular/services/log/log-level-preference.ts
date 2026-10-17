import { effect, inject, Service, Signal, untracked } from '@angular/core';
import { LogLevelSetting } from '@shared/api/log-channels';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Applies the `application.logLevel` setting to the logging floor, in this window and in the main
 * process, whenever it changes. A separate service because the Settings store itself logs through
 * {@link Log}, so the log service cannot depend on it in turn.
 *
 * The main process persists the choice alongside its startup preferences, so the next launch applies
 * it from its first record — before any window, or this service, exists.
 */
@Service()
export class LogLevelPreference {
  /**
   * Holds the settings store the choice lives in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the logging client the choice is applied through.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the chosen log level.
   */
  private readonly level: Signal<LogLevelSetting> = this.settings.value('application.logLevel');

  /**
   * Initializes the service, applying the setting now and on every change.
   */
  public constructor() {
    effect((): void => {
      const level: LogLevelSetting = this.level();
      untracked((): void => void this.log.setLevel(level));
    });
  }
}
