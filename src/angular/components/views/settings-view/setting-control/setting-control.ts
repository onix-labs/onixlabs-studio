import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Dropdown, DropdownOption } from '../../../forms/dropdown/dropdown';
import { NumberField } from '../../../forms/number-field/number-field';
import { TextField } from '../../../forms/text-field/text-field';
import { Toggle } from '../../../forms/toggle/toggle';
import { Settings } from '../../../../services/settings/settings';
import {
  ControlDef,
  SETTINGS_BY_KEY,
  SettingsKey,
} from '../../../../services/settings/settings-registry';

/**
 * Renders and edits a single setting, selecting the form control from the setting's registry control
 * definition and binding it to the Settings service by key.
 *
 * This is the data-driven half of the settings UI: it is intentionally key-dynamic, so it works
 * against the loosely-typed renderer accessors (`reactive`/`assign`) on the Settings service rather
 * than the statically-typed `get`/`set`.
 */
@Component({
  selector: 'app-setting-control',
  imports: [Toggle, TextField, NumberField, Dropdown],
  templateUrl: './setting-control.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingControl {
  /**
   * Holds the settings service the control is bound to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the key of the setting rendered by this control.
   */
  public readonly key: InputSignal<string> = input.required<string>();

  /**
   * Gets the control definition for the current setting.
   */
  protected readonly control: Signal<ControlDef | undefined> = computed(
    (): ControlDef | undefined => SETTINGS_BY_KEY.get(this.key() as SettingsKey)?.control,
  );

  /**
   * Gets the discriminating kind of the current control.
   */
  protected readonly kind: Signal<ControlDef['kind'] | undefined> = computed(
    (): ControlDef['kind'] | undefined => this.control()?.kind,
  );

  /**
   * Gets the current value of the setting.
   */
  protected readonly current: Signal<unknown> = computed((): unknown =>
    this.settings.reactive(this.key() as SettingsKey)(),
  );

  /**
   * Gets the options offered by a choice control, or an empty list for other controls.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const control: ControlDef | undefined = this.control();
      return control?.kind === 'select' || control?.kind === 'buttonGroup' ? control.options : [];
    },
  );

  /**
   * Gets the placeholder for a text control, or an empty string for other controls.
   */
  protected readonly placeholder: Signal<string> = computed((): string => {
    const control: ControlDef | undefined = this.control();
    return control?.kind === 'text' ? (control.placeholder ?? '') : '';
  });

  /**
   * Gets the minimum for a numeric control, or undefined when unbounded.
   */
  protected readonly min: Signal<number | undefined> = computed((): number | undefined => {
    const control: ControlDef | undefined = this.control();
    return control?.kind === 'number' ? control.min : undefined;
  });

  /**
   * Gets the maximum for a numeric control, or undefined when unbounded.
   */
  protected readonly max: Signal<number | undefined> = computed((): number | undefined => {
    const control: ControlDef | undefined = this.control();
    return control?.kind === 'number' ? control.max : undefined;
  });

  /**
   * Gets the step increment for a numeric control.
   */
  protected readonly step: Signal<number> = computed((): number => {
    const control: ControlDef | undefined = this.control();
    return control?.kind === 'number' ? (control.step ?? 1) : 1;
  });

  /**
   * Writes a new value for the current setting through the service.
   * @param value The value picked or entered in the control.
   */
  protected onChange(value: unknown): void {
    this.settings.assign(this.key() as SettingsKey, value);
  }
}
