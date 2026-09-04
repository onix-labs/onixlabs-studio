import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { SettingControl } from '../setting-control/setting-control';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { SettingDescriptions } from '@features/settings/angular/setting-descriptions';
import { SettingBinding, SettingBindings } from '@features/settings/angular/setting-bindings';
import { findSection, SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import { SettingDef, VisibilityDef } from '@shared/angular/services/settings/settings-schema';

/**
 * Renders a settings section entirely from the registry: every setting in the section becomes a
 * labelled row paired with the control its definition selects. Adding a setting to the section is a
 * single registry entry — no change is needed here.
 *
 * Settings whose control is `custom` are skipped: they are structurally complex and rendered by a
 * bespoke host that embeds this component for the rest of the section.
 */
@Component({
  selector: 'app-settings-section',
  imports: [SettingRow, SettingControl],
  templateUrl: './settings-section.html',
  styleUrls: ['../sections/section.scss', './settings-section.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSection {
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
   * Gets the identifier of the section to render.
   */
  public readonly sectionId: InputSignal<string> = input.required<string>();

  /**
   * Gets the settings in the section that this component renders, in display order (excluding custom
   * controls, and those whose condition is not currently met).
   */
  protected readonly settings: Signal<readonly SettingDef[]> = computed(
    (): readonly SettingDef[] =>
      findSection(this.sectionId())?.settings.filter(
        (setting: SettingDef): boolean =>
          setting.control.kind !== 'custom' && this.isVisible(setting),
      ) ?? [],
  );

  /**
   * Determines whether a setting's condition is met, so a setting that qualifies another appears only
   * while it has something to qualify. Reads the depended-on value through the binding layer rather
   * than the settings store directly, so the condition can name a foreign-owned setting (the
   * graphics-acceleration level, for one) as readily as a stored one. The read is reactive, so the
   * row appears and disappears as that setting changes.
   *
   * Where the binding offers a resolved value, that is what the condition tests: a setting qualified
   * on a specific level has to follow the level actually in force, not an automatic mode's name.
   * @param setting The setting definition.
   * @returns Returns true when the setting should be rendered.
   */
  private isVisible(setting: SettingDef): boolean {
    const condition: VisibilityDef | undefined = setting.visibleWhen;
    if (condition === undefined) return true;

    const dependency: SettingDef | undefined = SETTINGS_BY_KEY.get(condition.key);
    const binding: SettingBinding = this.bindings.resolve(condition.key, dependency?.owner);
    return condition.equals.includes((binding.resolvedValue ?? binding.value)());
  }

  /**
   * Gets the optional hint shown beneath the section's settings.
   */
  protected readonly footer: Signal<string | undefined> = computed(
    (): string | undefined => findSection(this.sectionId())?.footer,
  );

  /**
   * Returns the description shown for a setting, preferring a dynamic description when one is
   * available and falling back to the registry's static text.
   * @param setting The setting definition.
   * @returns Returns the description to render.
   */
  protected describe(setting: SettingDef): string {
    return this.descriptions.resolve(setting.key) ?? setting.description;
  }
}
