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
import { SettingDef, sectionSettings } from '../../../../services/settings/settings-registry';

/**
 * Renders a settings section entirely from the registry: every setting in the section becomes a
 * labelled row paired with the control its definition selects. Adding a setting to the section is a
 * single registry entry — no change is needed here.
 */
@Component({
  selector: 'app-settings-section',
  imports: [SettingRow, SettingControl],
  templateUrl: './settings-section.html',
  styleUrl: '../sections/section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSection {
  /**
   * Gets the identifier of the section to render.
   */
  public readonly sectionId: InputSignal<string> = input.required<string>();

  /**
   * Gets the settings in the section, in display order.
   */
  protected readonly settings: Signal<readonly SettingDef[]> = computed(
    (): readonly SettingDef[] => sectionSettings(this.sectionId()),
  );
}
