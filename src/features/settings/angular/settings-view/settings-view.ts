import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { SettingsNavigation } from '@shared/angular/services/settings-navigation/settings-navigation';
import { AiSettingsSection } from './sections/ai-settings/ai-settings';
import { KeyboardSettingsSection } from './sections/keyboard-settings/keyboard-settings';
import { TerminalSettingsSection } from './sections/terminal-settings/terminal-settings';
import { EditorProfiles } from './editor-profiles/editor-profiles';
import { SettingsSection } from './settings-section/settings-section';
import { SettingsRestart } from '@features/settings/angular/settings-restart';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * Identifies a section in the settings navigation.
 */
type SettingsSectionId =
  | 'appearance'
  | 'application'
  | 'notifications'
  | 'text-editor'
  | 'markdown'
  | 'terminal'
  | 'keyboard'
  | 'ai'
  | 'mission-control'
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
    Button,
    EditorProfiles,
    AiSettingsSection,
    KeyboardSettingsSection,
    TerminalSettingsSection,
    SettingsSection,
    AppIcon,
  ],
  templateUrl: './settings-view.html',
  styleUrl: './settings-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsView {
  /**
   * Holds the restart aggregator backing the global "restart required" banner.
   */
  private readonly restart: SettingsRestart = inject(SettingsRestart);

  /**
   * Holds the deep-link seam, so a request to open a specific section (e.g. Mission Control's gear)
   * switches the content pane on open.
   */
  private readonly navigation: SettingsNavigation = inject(SettingsNavigation);

  /**
   * Holds the identifier of the section currently shown in the content pane.
   */
  private readonly section: WritableSignal<SettingsSectionId> =
    signal<SettingsSectionId>('appearance');

  /**
   * Gets whether any setting has a change awaiting an application restart.
   */
  protected readonly restartRequired: Signal<boolean> = this.restart.restartRequired;

  /**
   * Gets the identifier of the settings tab. Part of the feature-view input contract; the settings
   * view is a singleton and does not key state on it.
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

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
    { id: 'notifications', label: 'Notifications', icon: Icon.BELL },
    { id: 'workspaces', label: 'Workspaces', icon: Icon.DIRECTORY },
    { id: 'text-editor', label: 'Text Editor', icon: Icon.SETTINGS_TEXT_EDITOR },
    { id: 'markdown', label: 'Markdown', icon: Icon.SETTINGS_MARKDOWN },
    { id: 'terminal', label: 'Terminal', icon: Icon.TERMINAL },
    { id: 'keyboard', label: 'Keyboard', icon: Icon.KEYBOARD },
    { id: 'ai', label: 'AI', icon: Icon.AGENT },
    { id: 'mission-control', label: 'Mission Control', icon: Icon.ROCKET_LAUNCH },
    { id: 'language-servers', label: 'Language Servers', icon: Icon.CODE_INLINE },
    { id: 'security', label: 'Security', icon: Icon.LOCK },
  ];

  /**
   * Consumes a pending deep-link request (see {@link SettingsNavigation}): when another surface asks to
   * open a specific section, switch to it and clear the request so a later manual change stands.
   */
  private readonly navigationEffect: ReturnType<typeof effect> = effect((): void => {
    const target: string | null = this.navigation.requestedSection();
    if (target === null) {
      return;
    }
    if (this.sections.some((section: SettingsNavSection): boolean => section.id === target)) {
      untracked((): void => this.section.set(target as SettingsSectionId));
    }
    untracked((): void => this.navigation.consume());
  });

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

  /**
   * Relaunches the application so pending restart-gated changes can take effect.
   */
  protected relaunch(): void {
    this.restart.relaunch();
  }
}
