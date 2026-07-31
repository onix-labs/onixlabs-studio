import type { Icon } from '@shared/angular/icons/icon';
import type { SettingsKey } from './settings-registry';

/**
 * Defines a selectable option in a choice control (select or button group). The {@link value} is the
 * semantic value persisted and read by consumers; the {@link label} is presentation only.
 */
export interface ChoiceOption {
  /**
   * Gets the value applied when the option is selected.
   */
  readonly value: string;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets the optional icon shown before the label (button groups only).
   */
  readonly icon?: Icon;
}

/**
 * Describes the control used to render and edit a setting. The {@link ControlDef.kind} discriminates
 * the shape: each kind carries only the metadata that kind needs.
 *
 * `accent` is the bespoke accent picker (preset swatches plus custom hue/saturation), rendered inline
 * by the generic renderer. `custom` is the escape hatch for structurally complex settings
 * (per-language editor profiles, the per-provider AI model map) that the generic renderer cannot
 * model; those are rendered by the named bespoke component instead.
 */
export type ControlDef =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'text'; readonly placeholder?: string }
  | {
      readonly kind: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly unit?: string;
    }
  | {
      readonly kind: 'select';
      readonly options: readonly ChoiceOption[];
      /**
       * Gets how the option value (always a string in the UI) is stored. `number` coerces the picked
       * value with `Number()` before writing, so a numeric setting keeps its numeric type; the default
       * `string` writes the value unchanged.
       */
      readonly valueType?: 'string' | 'number';
    }
  | { readonly kind: 'buttonGroup'; readonly options: readonly ChoiceOption[] }
  | { readonly kind: 'accent' }
  | { readonly kind: 'custom'; readonly component: string };

/**
 * Identifies which service owns a setting's value. A setting owned by `settings` lives in the Settings
 * store; other owners (the Theme, Display, LSP and Security services) own their own state, and the
 * renderer binds to them through the {@link import('../../../../features/settings/angular/setting-bindings').SettingBindings} resolver.
 */
export type SettingOwner = 'settings' | 'theme' | 'display' | 'lsp' | 'security';

/**
 * Identifies an owner other than the Settings service.
 */
export type ForeignOwner = Exclude<SettingOwner, 'settings'>;

/**
 * Holds the display and control fields shared by every setting definition.
 */
interface BaseSettingDef {
  /**
   * Gets the label shown for the setting.
   */
  readonly title: string;

  /**
   * Gets the description shown beneath the label.
   */
  readonly description: string;

  /**
   * Gets the control used to render and edit the setting.
   */
  readonly control: ControlDef;

  /**
   * Gets a value indicating whether this setting can be overridden by a per-language editor profile.
   * Used to drive the profile override editor from the registry.
   */
  readonly profileOverridable?: boolean;

  /**
   * Gets a value indicating whether changing this setting requires an application restart to take
   * effect. The settings view aggregates these into a single "restart required" banner; the setting's
   * binding reports when a change is actually pending (see `SettingBinding.restartPending`).
   */
  readonly requiresRestart?: boolean;
}

/**
 * Describes a setting owned by the Settings store. Its key is checked against
 * {@link import('./settings-registry').SettingsValues}, and it carries the default applied when no
 * override is persisted.
 */
export interface SettingsOwnedDef extends BaseSettingDef {
  /**
   * Gets the owner of the value (the Settings store).
   */
  readonly owner?: 'settings';

  /**
   * Gets the stable, namespaced lookup key (for example `application.undoStackSize`).
   */
  readonly key: SettingsKey;

  /**
   * Gets the default value applied when no user override is persisted.
   */
  readonly default: unknown;
}

/**
 * Describes a setting owned by another service (Theme, Display, LSP or Security). Its value lives in
 * that service, so it has no Settings-store default; the renderer reads and writes it through the
 * binding resolver.
 */
export interface ForeignSettingDef extends BaseSettingDef {
  /**
   * Gets the owner of the value.
   */
  readonly owner: ForeignOwner;

  /**
   * Gets the stable, namespaced lookup key (for example `security.imagePolicy`).
   */
  readonly key: string;
}

/**
 * Describes a single setting: its stable key, the display text, the control used to edit it, and the
 * service that owns its value. Defaults are the actual value (never an index), so reordering a
 * control's options can never corrupt persisted state.
 */
export type SettingDef = SettingsOwnedDef | ForeignSettingDef;

/**
 * Describes a settings section: a titled group of settings.
 */
export interface SectionDef {
  /**
   * Gets the identifier of the section, matching the settings navigation.
   */
  readonly id: string;

  /**
   * Gets the label shown for the section.
   */
  readonly label: string;

  /**
   * Gets the settings in the section, in display order.
   */
  readonly settings: readonly SettingDef[];

  /**
   * Gets the optional hint shown beneath the section's settings.
   */
  readonly footer?: string;
}

/**
 * Determines whether a setting is owned by the Settings store.
 * @param def The setting definition.
 * @returns Returns true when the setting is Settings-owned.
 */
export function isSettingsOwned(def: SettingDef): def is SettingsOwnedDef {
  return def.owner === undefined || def.owner === 'settings';
}
