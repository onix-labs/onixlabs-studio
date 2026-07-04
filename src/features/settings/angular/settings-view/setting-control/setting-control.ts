import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ButtonGroup } from '@shared/angular/components/forms/button-group/button-group';
import { ColorSwatches } from '@shared/angular/components/forms/color-swatches/color-swatches';
import { Dropdown } from '@shared/angular/components/forms/dropdown/dropdown';
import { NumberField } from '@shared/angular/components/forms/number-field/number-field';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { SettingBinding, SettingBindings } from '@features/settings/angular/setting-bindings';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import {
  ChoiceOption,
  ColorSwatch,
  ControlDef,
  SettingDef,
} from '@shared/angular/services/settings/settings-schema';

/**
 * Renders and edits a single setting, selecting the form control from the setting's registry control
 * definition and binding it to the owning service through the {@link SettingBindings} resolver.
 *
 * This is the data-driven half of the settings UI: it is intentionally key-dynamic and owner-agnostic,
 * so it renders settings owned by the Settings store as well as by other services (LSP, Security, and
 * in future Theme and Display).
 */
@Component({
  selector: 'app-setting-control',
  imports: [Toggle, TextField, NumberField, Dropdown, ButtonGroup, ColorSwatches],
  templateUrl: './setting-control.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingControl {
  /**
   * Holds the binding resolver the control reads and writes through.
   */
  private readonly bindings: SettingBindings = inject(SettingBindings);

  /**
   * Gets the key of the setting rendered by this control.
   */
  public readonly key: InputSignal<string> = input.required<string>();

  /**
   * Gets the registry definition for the current setting.
   */
  protected readonly definition: Signal<SettingDef | undefined> = computed(
    (): SettingDef | undefined => SETTINGS_BY_KEY.get(this.key()),
  );

  /**
   * Gets the control definition for the current setting.
   */
  protected readonly control: Signal<ControlDef | undefined> = computed(
    (): ControlDef | undefined => this.definition()?.control,
  );

  /**
   * Gets the discriminating kind of the current control.
   */
  protected readonly kind: Signal<ControlDef['kind'] | undefined> = computed(
    (): ControlDef['kind'] | undefined => this.control()?.kind,
  );

  /**
   * Gets the binding for the current setting, resolved from its owner.
   */
  private readonly binding: Signal<SettingBinding> = computed(
    (): SettingBinding => this.bindings.resolve(this.key(), this.definition()?.owner),
  );

  /**
   * Gets the current value of the setting.
   */
  protected readonly current: Signal<unknown> = computed((): unknown => this.binding().value());

  /**
   * Gets whether the control is disabled (for example when the owning bridge is unavailable).
   */
  protected readonly disabled: Signal<boolean> = computed(
    (): boolean => this.binding().disabled?.() ?? false,
  );

  /**
   * Gets the options offered by a choice control, or an empty list for other controls.
   */
  protected readonly options: Signal<readonly ChoiceOption[]> = computed(
    (): readonly ChoiceOption[] => {
      const control: ControlDef | undefined = this.control();
      return control?.kind === 'select' || control?.kind === 'buttonGroup' ? control.options : [];
    },
  );

  /**
   * Gets the swatches offered by a colour control, or an empty list for other controls.
   */
  protected readonly swatches: Signal<readonly ColorSwatch[]> = computed(
    (): readonly ColorSwatch[] => {
      const control: ControlDef | undefined = this.control();
      return control?.kind === 'color' ? control.swatches : [];
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
   * Writes a new value for the current setting through its binding.
   * @param value The value picked or entered in the control.
   */
  protected onChange(value: unknown): void {
    this.binding().set(value);
  }
}
