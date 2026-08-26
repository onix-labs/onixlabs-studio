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
import { SourceControlSettingsSection } from './sections/source-control-settings/source-control-settings';
import { TerminalSettingsSection } from './sections/terminal-settings/terminal-settings';
import { EditorProfiles } from './editor-profiles/editor-profiles';
import { LanguageServerPicker } from './language-server-picker/language-server-picker';
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
  | 'accessibility'
  | 'notifications'
  | 'text-editor'
  | 'markdown'
  | 'terminal'
  | 'keyboard'
  | 'ai'
  | 'ai-security'
  | 'mission-control'
  | 'ai-provider-anthropic'
  | 'ai-provider-openai'
  | 'ai-provider-google'
  | 'ai-provider-deepseek'
  | 'ai-provider-xai'
  | 'ai-provider-ollama'
  | 'ai-provider-custom'
  | 'source-control'
  | 'language-servers'
  | 'security'
  | 'workspaces';

/**
 * Describes a node in the settings navigation tree. A node is either a selectable leaf — it names the
 * section content it shows through {@link sectionId} — or an expandable branch — it groups
 * {@link children} and toggles their visibility without content of its own. Roots carry an {@link icon};
 * deeper nodes do not. Nesting is arbitrary, so a branch (Providers) can sit beneath another branch
 * (Artificial Intelligence).
 */
interface SettingsNavNode {
  /**
   * Gets the node's identifier, unique across the tree; it keys the node's row and its expansion.
   */
  readonly id: string;

  /**
   * Gets the label shown for the node.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the node, when it has one (roots only).
   */
  readonly icon?: Icon;

  /**
   * Gets the section content the node shows when selected, for a leaf; absent for a branch.
   */
  readonly sectionId?: SettingsSectionId;

  /**
   * Gets the node's children, for a branch; absent for a leaf.
   */
  readonly children?: readonly SettingsNavNode[];
}

/**
 * Carries the payload rendered into a settings navigation tree row: its label, its icon (roots only),
 * whether it is an expandable branch, and — for a leaf — the section content it selects.
 */
interface SettingsTreeData {
  /**
   * Gets the label shown for the row.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the row, when it has one (roots only).
   */
  readonly icon?: Icon;

  /**
   * Gets a value indicating whether the row is an expandable branch (toggles) rather than a leaf.
   */
  readonly expandable: boolean;

  /**
   * Gets the section content a leaf row selects; absent for a branch row.
   */
  readonly sectionId?: SettingsSectionId;
}

/**
 * Represents the settings view, hosting the contextual settings sections in a left-nav layout.
 */
@Component({
  selector: 'app-settings-view',
  imports: [
    Button,
    EditorProfiles,
    LanguageServerPicker,
    AiSettingsSection,
    KeyboardSettingsSection,
    SourceControlSettingsSection,
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
   * Holds the ids of the navigation nodes currently expanded in the tree. The root containing the
   * initially-shown section (Appearance, under Application) starts expanded so the selected leaf is
   * visible.
   */
  private readonly expandedNodes: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(['application']),
  );

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
   * Gets the settings navigation tree, in display order. Single-section categories carry one "General"
   * leaf; Application and Artificial Intelligence group several, and the latter nests a Providers branch
   * with a leaf per company.
   */
  protected readonly sections: readonly SettingsNavNode[] = [
    {
      id: 'application',
      label: 'Application',
      icon: Icon.APPLICATION,
      children: [
        { id: 'application-general', label: 'General', sectionId: 'application' },
        { id: 'application-appearance', label: 'Appearance', sectionId: 'appearance' },
        { id: 'application-keyboard', label: 'Keyboard', sectionId: 'keyboard' },
        { id: 'application-accessibility', label: 'Accessibility', sectionId: 'accessibility' },
        { id: 'application-notifications', label: 'Notifications', sectionId: 'notifications' },
        { id: 'application-security', label: 'Security', sectionId: 'security' },
      ],
    },
    {
      id: 'ai',
      label: 'Artificial Intelligence',
      icon: Icon.AGENT,
      children: [
        { id: 'ai-general', label: 'General', sectionId: 'ai' },
        { id: 'ai-security-leaf', label: 'Security & Permissions', sectionId: 'ai-security' },
        { id: 'ai-mission-control', label: 'Mission Control', sectionId: 'mission-control' },
        {
          id: 'ai-providers',
          label: 'Providers',
          children: [
            { id: 'ai-provider-anthropic', label: 'Anthropic', sectionId: 'ai-provider-anthropic' },
            { id: 'ai-provider-openai', label: 'OpenAI', sectionId: 'ai-provider-openai' },
            { id: 'ai-provider-google', label: 'Google', sectionId: 'ai-provider-google' },
            { id: 'ai-provider-deepseek', label: 'DeepSeek', sectionId: 'ai-provider-deepseek' },
            { id: 'ai-provider-xai', label: 'xAI', sectionId: 'ai-provider-xai' },
            { id: 'ai-provider-ollama', label: 'Ollama', sectionId: 'ai-provider-ollama' },
            { id: 'ai-provider-custom', label: 'Custom', sectionId: 'ai-provider-custom' },
          ],
        },
      ],
    },
    {
      id: 'workspaces',
      label: 'Workspaces',
      icon: Icon.DIRECTORY,
      children: [{ id: 'workspaces-general', label: 'General', sectionId: 'workspaces' }],
    },
    {
      id: 'source-control',
      label: 'Source Control',
      icon: Icon.SOURCE_CONTROL,
      children: [{ id: 'source-control-general', label: 'General', sectionId: 'source-control' }],
    },
    {
      id: 'text-editor',
      label: 'Text Editor',
      icon: Icon.SETTINGS_TEXT_EDITOR,
      children: [{ id: 'text-editor-general', label: 'General', sectionId: 'text-editor' }],
    },
    {
      id: 'markdown',
      label: 'Markdown',
      icon: Icon.SETTINGS_MARKDOWN,
      children: [{ id: 'markdown-general', label: 'General', sectionId: 'markdown' }],
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: Icon.TERMINAL,
      children: [{ id: 'terminal-general', label: 'General', sectionId: 'terminal' }],
    },
    {
      id: 'language-servers',
      label: 'Language Servers',
      icon: Icon.CODE_INLINE,
      children: [
        { id: 'language-servers-general', label: 'General', sectionId: 'language-servers' },
      ],
    },
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
    if (this.pathToSection(target as SettingsSectionId) !== null) {
      untracked((): void => this.showSection(target as SettingsSectionId));
    }
    untracked((): void => this.navigation.consume());
  });

  /**
   * Gets the identifier of the section currently shown in the content pane.
   */
  protected readonly selectedSection: Signal<SettingsSectionId> = this.section.asReadonly();

  /**
   * Gets the breadcrumb trail shown above the content pane: the labels along the path to the selected
   * leaf (for example ["Application", "General"] or ["Artificial Intelligence", "Providers",
   * "Anthropic"]), rendered as static, non-clickable crumbs.
   */
  protected readonly selectedTrail: Signal<readonly string[]> = computed((): readonly string[] => {
    const path: readonly SettingsNavNode[] | null = this.pathToSection(this.section());
    return path === null ? [] : path.map((node: SettingsNavNode): string => node.label);
  });

  /**
   * Gets the flattened navigation rows: every node in order, indented by depth, with a branch's children
   * following it only while it is expanded.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const expanded: ReadonlySet<string> = this.expandedNodes();
    const rows: TreeRow[] = [];
    this.appendRows(this.sections, 0, expanded, rows);
    return rows;
  });

  /**
   * Gets the id of the selected navigation row: the leaf whose content is on show, or null when none.
   */
  protected readonly selectedRowId: Signal<string | null> = computed((): string | null => {
    const path: readonly SettingsNavNode[] | null = this.pathToSection(this.section());
    return path === null ? null : path[path.length - 1].id;
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
   * Handles a click on a navigation row: a branch toggles its expansion, while a leaf shows its section's
   * content.
   * @param row The clicked row.
   */
  protected onRowClick(row: TreeRow): void {
    const data: SettingsTreeData = this.dataOf(row);
    if (data.expandable) {
      this.toggleNode(row.id);
    } else if (data.sectionId !== undefined) {
      this.log.debug('settings', 'Section selected', data.sectionId);
      this.section.set(data.sectionId);
    }
  }

  /**
   * Appends a node list to the flattened rows, recursing into each expanded branch.
   * @param nodes The nodes to append.
   * @param depth The depth of the nodes beneath the root.
   * @param expanded The ids of the currently-expanded nodes.
   * @param out The row list being built.
   */
  private appendRows(
    nodes: readonly SettingsNavNode[],
    depth: number,
    expanded: ReadonlySet<string>,
    out: TreeRow[],
  ): void {
    for (const node of nodes) {
      const isBranch: boolean = (node.children?.length ?? 0) > 0;
      const isExpanded: boolean = expanded.has(node.id);
      out.push({
        id: node.id,
        depth,
        expandable: isBranch,
        expanded: isExpanded,
        data: {
          label: node.label,
          icon: node.icon,
          expandable: isBranch,
          sectionId: node.sectionId,
        } satisfies SettingsTreeData,
      });
      if (isBranch && isExpanded && node.children !== undefined) {
        this.appendRows(node.children, depth + 1, expanded, out);
      }
    }
  }

  /**
   * Shows a section's content, expanding every ancestor along the path to it so the selected leaf is
   * visible.
   * @param id The identifier of the section to show.
   */
  private showSection(id: SettingsSectionId): void {
    this.log.debug('settings', 'Section shown via deep-link', id);
    this.section.set(id);
    const path: readonly SettingsNavNode[] | null = this.pathToSection(id);
    if (path === null) {
      return;
    }
    const ancestors: readonly string[] = path
      .slice(0, -1)
      .map((node: SettingsNavNode): string => node.id);
    this.expandedNodes.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      for (const ancestor of ancestors) {
        next.add(ancestor);
      }
      return next;
    });
  }

  /**
   * Finds the path of nodes from a root down to the leaf showing the given section content.
   * @param id The section content to locate.
   * @param nodes The nodes to search (the whole tree by default).
   * @param trail The nodes accumulated on the way down (empty at the root).
   * @returns Returns the path root→leaf, or null when no leaf shows that content.
   */
  private pathToSection(
    id: SettingsSectionId,
    nodes: readonly SettingsNavNode[] = this.sections,
    trail: readonly SettingsNavNode[] = [],
  ): readonly SettingsNavNode[] | null {
    for (const node of nodes) {
      const next: readonly SettingsNavNode[] = [...trail, node];
      if (node.sectionId === id) {
        return next;
      }
      if (node.children !== undefined) {
        const found: readonly SettingsNavNode[] | null = this.pathToSection(
          id,
          node.children,
          next,
        );
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Toggles a branch node's expansion in the navigation tree.
   * @param id The identifier of the node to toggle.
   */
  private toggleNode(id: string): void {
    this.expandedNodes.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Relaunches the application so pending restart-gated changes can take effect.
   */
  protected relaunch(): void {
    this.log.info('settings', 'Relaunch requested from restart banner');
    this.restart.relaunch();
  }
}
