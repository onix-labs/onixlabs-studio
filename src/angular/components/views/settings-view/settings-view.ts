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
import { AiSettingsSection } from './sections/ai-settings/ai-settings';
import { AppearanceSettings } from './sections/appearance-settings/appearance-settings';
import { LanguageServersSettings } from './sections/language-servers-settings/language-servers-settings';
import { SecuritySettingsSection } from './sections/security-settings/security-settings';
import { TextEditorSettingsSection } from './sections/text-editor-settings/text-editor-settings';
import { SettingsSection } from './settings-section/settings-section';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../../shared/icon/app-icon';

/**
 * Identifies a section in the settings navigation.
 */
type SettingsSectionId =
  | 'appearance'
  | 'application'
  | 'text-editor'
  | 'markdown'
  | 'ai'
  | 'language-servers'
  | 'security'
  | 'workspaces';

/**
 * Describes a selectable section in the settings navigation.
 */
interface SettingsNavSection {
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
  readonly icon: Icon;
}

/**
 * Represents the settings view, hosting the contextual settings sections in a left-nav layout.
 */
@Component({
  selector: 'app-settings-view',
  imports: [
    AppearanceSettings,
    TextEditorSettingsSection,
    AiSettingsSection,
    LanguageServersSettings,
    SecuritySettingsSection,
    SettingsSection,
    AppIcon,
  ],
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
  protected readonly sections: readonly SettingsNavSection[] = [
    { id: 'appearance', label: 'Appearance', icon: Icon.PALETTE },
    { id: 'application', label: 'Application', icon: Icon.APPLICATION },
    { id: 'workspaces', label: 'Workspaces', icon: Icon.DIRECTORY },
    { id: 'text-editor', label: 'Text Editor', icon: Icon.SETTINGS_TEXT_EDITOR },
    { id: 'markdown', label: 'Markdown', icon: Icon.SETTINGS_MARKDOWN },
    { id: 'ai', label: 'AI', icon: Icon.AGENT },
    { id: 'language-servers', label: 'Language Servers', icon: Icon.CODE_INLINE },
    { id: 'security', label: 'Security', icon: Icon.LOCK },
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
      this.sections.find((section: SettingsNavSection): boolean => section.id === this.section())
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
