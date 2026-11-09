import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { PluginSuggestions } from '@shared/angular/services/plugins/plugin-suggestions';

/**
 * Represents the Turned-Down Suggestions row on Plugins › General: how many plugin offers were turned
 * off with "Don't Suggest This Again", and a button that lets them be made again. Shown only while
 * there are some.
 */
@Component({
  selector: 'app-plugin-suggestions-dismissed',
  imports: [Button, SettingRow],
  templateUrl: './plugin-suggestions-dismissed.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginSuggestionsDismissed {
  /**
   * Holds the suggestions, which know what was turned down.
   */
  protected readonly suggestions: PluginSuggestions = inject(PluginSuggestions);

  /**
   * Gets the row's description, counting the offers turned down.
   */
  protected readonly description: Signal<string> = computed((): string => {
    const count: number = this.suggestions.dismissedCount();
    return (
      `${count === 1 ? 'One plugin offer is' : `${count} plugin offers are`} turned off with ` +
      "Don't Suggest This Again. Suggest Them Again lets Studio make them once more."
    );
  });
}
