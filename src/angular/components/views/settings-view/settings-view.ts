import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { ApplicationSettings } from './sections/application-settings/application-settings';
import { AppearanceSettings } from './sections/appearance-settings/appearance-settings';
import { MarkdownSettings } from './sections/markdown-settings/markdown-settings';
import { TextEditorSettingsSection } from './sections/text-editor-settings/text-editor-settings';

/**
 * Identifies a section in the settings navigation.
 */
type SettingsSectionId = 'appearance' | 'application' | 'text-editor' | 'markdown';

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
 * Represents the settings view, hosting the contextual settings sections in a left-nav layout.
 */
@Component({
  selector: 'app-settings-view',
  imports: [AppearanceSettings, ApplicationSettings, TextEditorSettingsSection, MarkdownSettings],
  templateUrl: './settings-view.html',
  styleUrl: './settings-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsView {
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
    { id: 'application', label: 'Application', icon: 'ti ti-app-window' },
    { id: 'text-editor', label: 'Text Editor', icon: 'ti ti-file-code' },
    { id: 'markdown', label: 'Markdown', icon: 'ti ti-markdown' },
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
   * Selects the given settings section.
   * @param id The identifier of the section to show.
   */
  protected selectSection(id: SettingsSectionId): void {
    this.section.set(id);
  }
}
