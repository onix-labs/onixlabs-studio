import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { SettingControl } from '../setting-control/setting-control';
import { SettingRow } from '../../../forms/setting-row/setting-row';
import { findSection, SettingDef } from '../../../../services/settings/settings-registry';

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
   * Gets the identifier of the section to render.
   */
  public readonly sectionId: InputSignal<string> = input.required<string>();

  /**
   * Gets the settings in the section that this component renders, in display order (excluding custom
   * controls).
   */
  protected readonly settings: Signal<readonly SettingDef[]> = computed(
    (): readonly SettingDef[] =>
      findSection(this.sectionId())?.settings.filter(
        (setting: SettingDef): boolean => setting.control.kind !== 'custom',
      ) ?? [],
  );

  /**
   * Gets the optional hint shown beneath the section's settings.
   */
  protected readonly footer: Signal<string | undefined> = computed(
    (): string | undefined => findSection(this.sectionId())?.footer,
  );
}
