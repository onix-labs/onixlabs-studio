import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AccentColor, ACCENT_COLORS, Theme, ThemeMode } from '../../../services/theme/theme';

/**
 * Identifies a section in the settings navigation.
 */
type SettingsSectionId = 'appearance' | 'editor' | 'terminal' | 'about';

/**
 * Describes a selectable section in the settings navigation.
 */
interface SettingsSection {
  /**
   * Gets the identifier of the section.
   */
  readonly id: SettingsSectionId;

  /**
   * Gets the label shown for the section.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the section.
   */
  readonly icon: string;
}

/**
 * Describes a selectable theme-mode option in the appearance settings.
 */
interface ThemeModeOption {
  /**
   * Gets the theme mode the option applies.
   */
  readonly value: ThemeMode;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the option.
   */
  readonly icon: string;
}

/**
 * Represents the settings view, hosting the appearance controls.
 */
@Component({
  selector: 'app-settings-view',
  imports: [],
  templateUrl: './settings-view.html',
  styleUrl: './settings-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsView {
  /**
   * Holds the theme service the appearance controls drive.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the identifier of the section currently shown in the content pane.
   */
  private readonly section: WritableSignal<SettingsSectionId> =
    signal<SettingsSectionId>('appearance');

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the sections offered by the settings navigation, in display order.
   */
  protected readonly sections: readonly SettingsSection[] = [
    { id: 'appearance', label: 'Appearance', icon: 'ti ti-palette' },
    { id: 'editor', label: 'Editor', icon: 'ti ti-file-code' },
    { id: 'terminal', label: 'Terminal', icon: 'ti ti-terminal-2' },
    { id: 'about', label: 'About', icon: 'ti ti-info-circle' },
  ];

  /**
   * Gets the identifier of the section currently shown in the content pane.
   */
  protected readonly selectedSection: Signal<SettingsSectionId> = this.section.asReadonly();

  /**
   * Gets the label of the section currently shown in the content pane.
   */
  protected readonly selectedSectionLabel: Signal<string> = computed(
    (): string =>
      this.sections.find((section: SettingsSection): boolean => section.id === this.section())
        ?.label ?? '',
  );

  /**
   * Gets the currently selected theme mode.
   */
  protected readonly mode: Signal<ThemeMode> = this.theme.mode;

  /**
   * Gets the currently selected accent colour.
   */
  protected readonly accent: Signal<AccentColor> = this.theme.accent;

  /**
   * Gets the theme-mode options offered by the selector.
   */
  protected readonly modeOptions: readonly ThemeModeOption[] = [
    { value: 'light', label: 'Light', icon: 'ti ti-sun' },
    { value: 'dark', label: 'Dark', icon: 'ti ti-moon' },
    { value: 'system', label: 'System', icon: 'ti ti-device-desktop' },
  ];

  /**
   * Gets the accent colours offered by the picker, in palette order.
   */
  protected readonly accentColors: readonly AccentColor[] = ACCENT_COLORS;

  /**
   * Selects the given settings section.
   * @param id The identifier of the section to show.
   */
  protected selectSection(id: SettingsSectionId): void {
    this.section.set(id);
  }

  /**
   * Selects the given theme mode.
   * @param mode The theme mode to apply.
   */
  protected selectMode(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  /**
   * Selects the given accent colour.
   * @param accent The accent colour to apply.
   */
  protected selectAccent(accent: AccentColor): void {
    this.theme.setAccent(accent);
  }
}
