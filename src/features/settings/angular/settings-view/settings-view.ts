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
import { Log } from '@shared/angular/services/log/log';
import { AiSettingsSection } from './sections/ai-settings/ai-settings';
import { KeyboardSettingsSection } from './sections/keyboard-settings/keyboard-settings';
import { TerminalSettingsSection } from './sections/terminal-settings/terminal-settings';
import { EditorProfiles } from './editor-profiles/editor-profiles';
import { SettingsSection } from './settings-section/settings-section';
import { SettingsRestart } from '@features/settings/angular/settings-restart';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';

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
  | 'ai-security'
  | 'ai-agents'
  | 'mission-control'
  | 'language-servers'
  | 'security'
  | 'workspaces';

/**
 * Describes a leaf beneath a settings navigation root: a label and the section content it shows.
 */
interface SettingsNavItem {
  /**
   * Gets the label shown for the leaf.
   */
  readonly label: string;

  /**
   * Gets the section whose content the leaf shows.
   */
  readonly sectionId: SettingsSectionId;
}

/**
 * Describes a root category in the settings navigation. A root expands to reveal its leaves; when it
 * declares no {@link items}, it is given a single "General" leaf mapping to its own {@link id}.
 */
interface SettingsNavSection {
  /**
   * Gets the identifier of the root, used to track its expansion.
   */
  readonly id: SettingsSectionId;

  /**
   * Gets the label shown for the root.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the root.
   */
  readonly icon: Icon;

  /**
   * Gets the leaves beneath the root, or undefined for the default single "General" leaf.
   */
  readonly items?: readonly SettingsNavItem[];
}

/**
 * Carries the payload rendered into a settings navigation tree row. A "section" row is an expandable
 * root (a top-level category); an "item" row is a leaf beneath it that selects the content it names.
 * {@link target} is the root to toggle for a section row, or the section content to show for an item.
 */
interface SettingsTreeData {
  /**
   * Gets the kind of row: an expandable section root, or a selectable leaf item.
   */
  readonly kind: 'section' | 'item';

  /**
   * Gets the label shown for the row.
   */
  readonly label: string;

  /**
   * Gets the row's target: the root id a section row toggles, or the section an item row shows.
   */
  readonly target: SettingsSectionId;

  /**
   * Gets the icon shown for the row, when it has one (section roots only).
   */
  readonly icon?: Icon;
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
    TreeView,
  ],
  templateUrl: './settings-view.html',
  styleUrl: './settings-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsView {
  /**
   * Gets the icon set, exposed for the template (the breadcrumb chevron).
   */
  protected readonly Icon: typeof Icon = Icon;

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the identifier of the section currently shown in the content pane.
   */
  private readonly section: WritableSignal<SettingsSectionId> =
    signal<SettingsSectionId>('appearance');

  /**
   * Holds the ids of the section roots currently expanded in the navigation tree. The root containing
   * the initially-shown section (Appearance, under Application) starts expanded so the selected leaf
   * is visible.
   */
  private readonly expandedSections: WritableSignal<ReadonlySet<SettingsSectionId>> = signal<
    ReadonlySet<SettingsSectionId>
  >(new Set<SettingsSectionId>(['application']));

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
    {
      id: 'application',
      label: 'Application',
      icon: Icon.APPLICATION,
      items: [
        { label: 'General', sectionId: 'application' },
        { label: 'Appearance', sectionId: 'appearance' },
        { label: 'Keyboard', sectionId: 'keyboard' },
        { label: 'Notifications', sectionId: 'notifications' },
        { label: 'Security', sectionId: 'security' },
      ],
    },
    {
      id: 'ai',
      label: 'Artificial Intelligence',
      icon: Icon.AGENT,
      items: [
        { label: 'General', sectionId: 'ai' },
        { label: 'Security & Permissions', sectionId: 'ai-security' },
        { label: 'Agents & Providers', sectionId: 'ai-agents' },
        { label: 'Mission Control', sectionId: 'mission-control' },
      ],
    },
    { id: 'workspaces', label: 'Workspaces', icon: Icon.DIRECTORY },
    { id: 'text-editor', label: 'Text Editor', icon: Icon.SETTINGS_TEXT_EDITOR },
    { id: 'markdown', label: 'Markdown', icon: Icon.SETTINGS_MARKDOWN },
    { id: 'terminal', label: 'Terminal', icon: Icon.TERMINAL },
    { id: 'language-servers', label: 'Language Servers', icon: Icon.CODE_INLINE },
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
    if (this.rootFor(target as SettingsSectionId) !== null) {
      untracked((): void => this.showSection(target as SettingsSectionId));
    }
    untracked((): void => this.navigation.consume());
  });

  /**
   * Gets the identifier of the section currently shown in the content pane.
   */
  protected readonly selectedSection: Signal<SettingsSectionId> = this.section.asReadonly();

  /**
   * Gets the breadcrumb trail shown above the content pane: the root label followed by the selected
   * leaf's label (e.g. ["Application", "General"]), rendered as static, non-clickable crumbs.
   */
  protected readonly selectedTrail: Signal<readonly string[]> = computed((): readonly string[] => {
    const current: SettingsSectionId = this.section();
    for (const section of this.sections) {
      for (const item of this.itemsOf(section)) {
        if (item.sectionId === current) {
          return [section.label, item.label];
        }
      }
    }
    return [];
  });

  /**
   * Gets the flattened navigation rows: each section as an expandable root, and — when the root is
   * expanded — its leaves beneath it. A leaf's id combines its root and section so it is distinct from
   * both its root and any leaf with the same content elsewhere.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const expanded: ReadonlySet<SettingsSectionId> = this.expandedSections();
    const rows: TreeRow[] = [];
    for (const section of this.sections) {
      const isExpanded: boolean = expanded.has(section.id);
      rows.push({
        id: section.id,
        depth: 0,
        expandable: true,
        expanded: isExpanded,
        data: {
          kind: 'section',
          label: section.label,
          target: section.id,
          icon: section.icon,
        } satisfies SettingsTreeData,
      });
      if (isExpanded) {
        for (const item of this.itemsOf(section)) {
          rows.push({
            id: `${section.id}/${item.sectionId}`,
            depth: 1,
            expandable: false,
            expanded: false,
            data: {
              kind: 'item',
              label: item.label,
              target: item.sectionId,
            } satisfies SettingsTreeData,
          });
        }
      }
    }
    return rows;
  });

  /**
   * Gets the id of the selected navigation row: the leaf whose content is on show, or null when none.
   */
  protected readonly selectedRowId: Signal<string | null> = computed((): string | null => {
    const current: SettingsSectionId = this.section();
    const root: SettingsSectionId | null = this.rootFor(current);
    return root === null ? null : `${root}/${current}`;
  });

  /**
   * Reads a row's settings payload.
   * @param row The tree row.
   * @returns Returns the row's settings data.
   */
  protected dataOf(row: TreeRow): SettingsTreeData {
    return row.data as SettingsTreeData;
  }

  /**
   * Handles a click on a navigation row: a section root toggles its expansion, while a leaf shows its
   * section's content.
   * @param row The clicked row.
   */
  protected onRowClick(row: TreeRow): void {
    const data: SettingsTreeData = this.dataOf(row);
    if (data.kind === 'section') {
      this.toggleSection(data.target);
    } else {
      this.log.debug('settings', 'Section selected', data.target);
      this.section.set(data.target);
    }
  }

  /**
   * Shows a section's content, expanding the root that contains it so the selected leaf is visible.
   * @param id The identifier of the section to show.
   */
  private showSection(id: SettingsSectionId): void {
    this.log.debug('settings', 'Section shown via deep-link', id);
    this.section.set(id);
    const root: SettingsSectionId | null = this.rootFor(id);
    if (root !== null) {
      this.expandedSections.update(
        (current: ReadonlySet<SettingsSectionId>): ReadonlySet<SettingsSectionId> =>
          new Set<SettingsSectionId>(current).add(root),
      );
    }
  }

  /**
   * Gets a root's leaves, substituting the default single "General" leaf when it declares none.
   * @param section The root section.
   * @returns Returns the root's leaves.
   */
  private itemsOf(section: SettingsNavSection): readonly SettingsNavItem[] {
    return section.items ?? [{ label: 'General', sectionId: section.id }];
  }

  /**
   * Finds the id of the root whose leaves include the given section content.
   * @param id The section content to locate.
   * @returns Returns the containing root's id, or null when no leaf shows that content.
   */
  private rootFor(id: SettingsSectionId): SettingsSectionId | null {
    for (const section of this.sections) {
      if (this.itemsOf(section).some((item: SettingsNavItem): boolean => item.sectionId === id)) {
        return section.id;
      }
    }
    return null;
  }

  /**
   * Toggles a section root's expansion in the navigation tree.
   * @param id The identifier of the section to toggle.
   */
  private toggleSection(id: SettingsSectionId): void {
    this.expandedSections.update(
      (current: ReadonlySet<SettingsSectionId>): ReadonlySet<SettingsSectionId> => {
        const next: Set<SettingsSectionId> = new Set<SettingsSectionId>(current);
        if (!next.delete(id)) {
          next.add(id);
        }
        return next;
      },
    );
  }

  /**
   * Relaunches the application so pending restart-gated changes can take effect.
   */
  protected relaunch(): void {
    this.log.info('settings', 'Relaunch requested from restart banner');
    this.restart.relaunch();
  }
}
