import { computed, inject, Service, Signal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import type { NotificationAction } from '@shared/angular/services/notifications/notifications';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Decides whether Studio may suggest a plugin for something it cannot do yet — a language without a
 * server, a format without a decoder, a repository without its tool, a missing container engine —
 * and remembers the suggestions the user turned down for good.
 *
 * Suggest Plugins for Missing Support turns every such offer off; "Don't Suggest This Again" turns
 * off one, by the key the offer is made under (one per language, per format, and one each for
 * version control and container engines).
 */
@Service()
export class PluginSuggestions {
  /**
   * Holds the settings the choice and the turned-down offers live in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the keys of the offers the user turned down for good.
   */
  public readonly dismissed: Signal<readonly string[]> = this.settings.value(
    'plugins.dismissedSuggestions',
  );

  /**
   * Gets how many offers are turned down for good.
   */
  public readonly dismissedCount: Signal<number> = computed((): number => this.dismissed().length);

  /**
   * Determines whether an offer may be made.
   * @param key The key the offer is made under.
   * @returns Returns true when suggestions are on and this one was not turned down.
   */
  public allows(key: string): boolean {
    return this.settings.get('plugins.suggestPlugins') && !this.dismissed().includes(key);
  }

  /**
   * Builds the "Don't Suggest This Again" action an offer carries.
   * @param key The key the offer is made under.
   * @returns Returns the action.
   */
  public dontSuggestAgain(key: string): NotificationAction {
    return {
      label: "Don't Suggest This Again",
      run: (): void => this.dismiss(key),
    };
  }

  /**
   * Turns an offer down for good.
   * @param key The key the offer is made under.
   */
  public dismiss(key: string): void {
    if (this.dismissed().includes(key)) {
      return;
    }
    this.log.info('PluginSuggestions', 'Suggestion turned down for good', key);
    this.settings.set('plugins.dismissedSuggestions', [...this.dismissed(), key]);
  }

  /**
   * Lets every turned-down offer be made again.
   */
  public restore(): void {
    this.log.info('PluginSuggestions', 'Turned-down suggestions restored', this.dismissed().length);
    this.settings.set('plugins.dismissedSuggestions', []);
  }
}
