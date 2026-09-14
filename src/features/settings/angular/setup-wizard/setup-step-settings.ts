import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import { SettingDef, VisibilityDef } from '@shared/angular/services/settings/settings-schema';
import { SettingBinding, SettingBindings } from '@features/settings/angular/setting-bindings';
import { SettingDescriptions } from '@features/settings/angular/setting-descriptions';
import { SettingControl } from '@features/settings/angular/settings-view/setting-control/setting-control';

/**
 * Renders a chosen handful of settings for one step of the setup wizard.
 *
 * The sibling of {@link import('../settings-view/settings-section/settings-section').SettingsSection},
 * and deliberately not that component: a section renders everything a settings section holds, in
 * registry order, which is the right answer when the user went looking for a setting. A wizard step is
 * the opposite — a curated few, chosen because they decide whether Studio works, presented to someone
 * who did not go looking for anything. So a step names its keys rather than a section id, and the
 * Appearance step can carry the theme, the accent and the graphics level without also carrying ribbon
 * alignment.
 *
 * Everything below the choice of keys is shared with the settings view: the same binding resolver, the
 * same row, the same control per definition. A setting edited here is the same setting, written to the
 * same owner, and the settings view reflects it immediately.
 */
@Component({
  selector: 'app-setup-step-settings',
  imports: [SettingRow, SettingControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../settings-view/sections/section.scss'],
  template: `
    @for (setting of settings(); track setting.key) {
      <app-setting-row [label]="setting.title" [description]="describe(setting)">
        <app-setting-control [key]="setting.key" />
      </app-setting-row>
    }
  `,
})
export class SetupStepSettings {
  /**
   * Holds the dynamic-description resolver.
   */
  private readonly descriptions: SettingDescriptions = inject(SettingDescriptions);

  /**
   * Holds the binding resolver, used to read the value a setting's visibility condition depends on
   * whichever service owns it.
   */
  private readonly bindings: SettingBindings = inject(SettingBindings);

  /**
   * Gets the keys of the settings to render, in display order.
   */
  public readonly keys: InputSignal<readonly string[]> = input.required<readonly string[]>();

  /**
   * Gets the definitions to render: the named settings that exist, are not custom-rendered, and whose
   * visibility condition is currently met.
   *
   * A key naming nothing is dropped rather than rendered blank. It can only be a typo or a setting
   * that has since been removed, and a wizard step is the last place to surface an empty row — the
   * user has no way to tell it apart from a control that failed to load.
   */
  protected readonly settings: Signal<readonly SettingDef[]> = computed((): readonly SettingDef[] =>
    this.keys()
      .map((key: string): SettingDef | undefined => SETTINGS_BY_KEY.get(key))
      .filter(
        (setting: SettingDef | undefined): setting is SettingDef =>
          setting !== undefined && setting.control.kind !== 'custom' && this.isVisible(setting),
      ),
  );

  /**
   * Determines whether a setting's condition is met, reading the depended-on value through the
   * binding layer so the condition can name a foreign-owned setting as readily as a stored one. Where
   * the binding offers a resolved value that is what the condition tests, so a setting qualified on a
   * specific graphics level follows the level actually in force rather than the word `auto`.
   * @param setting The setting definition.
   * @returns Returns true when the setting should be rendered.
   */
  private isVisible(setting: SettingDef): boolean {
    const condition: VisibilityDef | undefined = setting.visibleWhen;
    if (condition === undefined) {
      return true;
    }
    const dependency: SettingDef | undefined = SETTINGS_BY_KEY.get(condition.key);
    const binding: SettingBinding = this.bindings.resolve(condition.key, dependency?.owner);
    return condition.equals.includes((binding.resolvedValue ?? binding.value)());
  }

  /**
   * Returns the description shown for a setting: its condensed text where it states one, with any
   * dynamic hint layered on top.
   *
   * A wizard step shows settings to someone who did not go looking for them, several steps from
   * where they were going, so a setting whose full text runs to a paragraph is one whose text does
   * not get read. The machine-specific part of a hint survives regardless — that is usually the most
   * useful thing on the screen.
   * @param setting The setting definition.
   * @returns Returns the description to render.
   */
  protected describe(setting: SettingDef): string {
    return (
      this.descriptions.resolveConcise(setting.key) ??
      setting.shortDescription ??
      setting.description
    );
  }
}
