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
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { languageDisplayName } from '@shared/angular/services/plugins/language-names';
import { AiSettingsSection } from './sections/ai-settings/ai-settings';
import { KeyboardSettingsSection } from './sections/keyboard-settings/keyboard-settings';
import { SourceControlSettingsSection } from './sections/source-control-settings/source-control-settings';
import { TerminalSettingsSection } from './sections/terminal-settings/terminal-settings';
import { LanguageEditorOverrides } from './language-editor-overrides/language-editor-overrides';
import { LanguageServerSettings } from './language-server-settings/language-server-settings';
import { SettingsSection } from './settings-section/settings-section';
import { PersonalDictionary } from './sections/personal-dictionary/personal-dictionary';
import { RememberedFileAccess } from './sections/remembered-file-access/remembered-file-access';
import { SpellCheckingLanguages } from './sections/spell-checking-languages/spell-checking-languages';
import { SettingsRestart } from '@features/settings/angular/settings-restart';
import type { ProviderPage } from '@shared/api/ai-types';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import {
  PendingSettingsImport,
  SettingsFileRead,
  SettingsTransfer,
} from '@features/settings/angular/settings-transfer';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { codeSettings, findSection } from '@shared/angular/services/settings/settings-registry';
import {
  appliesToPlatform,
  type SettingDef,
} from '@shared/angular/services/settings/settings-schema';

/**
 * Names the registry sections Version Control › General draws, in page order, each under its own
 * heading, so the page's search finds every one of them.
 */
const VERSION_CONTROL_SECTIONS: readonly string[] = ['vc-fetch', 'vc-commits', 'vc-history'];

/**
 * The keys of the AI registry settings each AI page shows. The registry keeps every AI setting in one
 * `ai` section while the tree splits them across pages, so the search has to be told which page each
 * lives on. A key named on neither (the connections, the CLI paths) is shown on no page the search can
 * point at, so it matches nothing rather than the wrong page.
 */
const AI_PAGE_KEYS: Readonly<Partial<Record<SettingsSectionId, ReadonlySet<string>>>> = {
  ai: new Set<string>([
    'ai.autoScroll',
    'ai.conversationTextSize',
    'ai.reportBackgroundTasks',
    'ai.tokenCap',
    'ai.runTimeoutMinutes',
    'ai.agentSessionLifetime',
    'ai.defaultReasoningEffort',
    'ai.maxStepsPerTurn',
    'ai.autoCompactThreshold',
    'ai.autoCompactMode',
    'ai.deleteConversationsAfterDays',
    'ai.deleteConversationsMode',
    'ai.maxLiveSessions',
    'ai.sendMessageWith',
    'ai.maxImagesPerMessage',
    'ai.maxImageSizeMb',
    'ai.expandToolCalls',
    'ai.expandThinking',
    'ai.confirmDeleteConversations',
    'ai.agentShell',
  ]),
  'ai-security': new Set<string>([
    'ai.permissionPosture',
    'ai.remoteControlPosture',
    'ai.toolPolicies',
    'ai.blockHostCommandLine',
    'ai.requireOsSandbox',
    'ai.autoAllowSandboxedShell',
    'ai.allowedWritePaths',
    'ai.deniedWritePaths',
    'ai.allowedNetworkLocations',
    'ai.deniedNetworkLocations',
  ]),
};

/**
 * Identifies a section in the settings navigation.
 */
type SettingsSectionId =
  | 'application'
  | 'accessibility'
  | 'notifications'
  | 'code-general'
  | 'code-appearance'
  | 'code-editing'
  | 'markdown'
  | 'terminal'
  | 'keyboard'
  | 'ai'
  | 'ai-security'
  | 'mission-control'
  | 'system-monitor'
  | 'database-explorer'
  | 'plugins'
  // One per provider an installed harness contributes, so the set is open (#653). It was seven fixed
  // literals — anthropic, openai, google, deepseek, xai, ollama, custom — which is what made the
  // Providers branch a list of companies core shipped rather than a list of what is installed.
  | `ai-provider-${string}`
  | 'source-control'
  | 'language-providers'
  | 'security'
  | 'workspaces'
  // One per capability whose shortcuts are catalogued, each a Keyboard leaf under that capability's
  // root; the bare `keyboard` is Application › Keyboard, for the shortcuts that belong to no one view.
  | `keyboard-${string}`;

/**
 * The More Actions menu's Import item.
 */
const MENU_IMPORT: string = 'settings.import';

/**
 * The More Actions menu's Export item.
 */
const MENU_EXPORT: string = 'settings.export';

/**
 * Names a group of roots in the settings tree, headed in the tree by its label.
 */
type SettingsGroupId = 'studio' | 'documents' | 'capabilities' | 'tools';

/**
 * Labels the groups of roots, in the order they appear. Studio holds what shapes the whole app, and the
 * pieces that appear throughout it (terminals, version control); Documents the kinds of content opened,
 * wherever they appear; Capabilities the tabs that put those together to work in; Tools the welcome
 * screen's tools.
 */
const SETTINGS_GROUPS: Readonly<Record<SettingsGroupId, string>> = {
  studio: 'Studio',
  documents: 'Documents',
  capabilities: 'Capabilities',
  tools: 'Tools',
};

/**
 * Maps each root to the keyboard catalogue view whose shortcuts its Keyboard leaf shows. A shortcut
 * belongs with the rest of its capability's settings, rather than in one list covering every view.
 */
const KEYBOARD_PAGES: Readonly<Record<string, string>> = {
  workspaces: 'Workspace',
  code: 'Code Editor',
  markdown: 'Markdown Editor',
  images: 'Image Viewer',
  terminal: 'Terminal',
  ai: 'Agent',
  'api-explorer': 'API Explorer',
  'database-explorer': 'Database Explorer',
  'system-monitor': 'System Monitor',
};

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
   * Gets the group a root belongs to, headed in the tree above it (roots only).
   */
  readonly group?: SettingsGroupId;

  /**
   * Gets the section content the node shows when selected, for a leaf; absent for a branch.
   */
  readonly sectionId?: SettingsSectionId;

  /**
   * Gets the language a leaf configures, for the Languages branch whose leaves all share one
   * section and differ only by the language they are about. Absent everywhere else.
   */
  readonly language?: string;

  /**
   * Gets the keyboard catalogue view a capability's Keyboard leaf shows. Absent everywhere else.
   */
  readonly keyboardView?: string;

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

  /**
   * Gets the language the row configures, for a Language Providers leaf.
   */
  readonly language?: string;
}

/**
 * Represents the settings view, hosting the contextual settings sections in a left-nav layout.
 */
@Component({
  selector: 'app-settings-view',
  imports: [
    Button,
    ButtonRow,
    Modal,
    ModalContent,
    PersonalDictionary,
    RememberedFileAccess,
    SpellCheckingLanguages,
    LanguageEditorOverrides,
    LanguageServerSettings,
    AiSettingsSection,
    KeyboardSettingsSection,
    SourceControlSettingsSection,
    TerminalSettingsSection,
    SettingsSection,
    AppIcon,
    TextField,
    TreeView,
    Accordion,
    CdkMenuTrigger,
    Menu,
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
   * Holds the language-server settings, which decide the languages the tree offers.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Holds the providers installed harnesses contribute, which the Providers branch is built from.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the keyboard catalogue, which decides the Keyboard leaves and lets search find a shortcut.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the settings export and import.
   */
  private readonly transfer: SettingsTransfer = inject(SettingsTransfer);

  /**
   * Holds the notifications service, which reports how an export or import went.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the settings file read for import, while the user decides what happens to the settings it
   * does not mention; null when no import is waiting.
   */
  protected readonly pendingImport: WritableSignal<PendingSettingsImport | null> =
    signal<PendingSettingsImport | null>(null);

  /**
   * Holds the identifier of the section currently shown in the content pane.
   */
  private readonly section: WritableSignal<SettingsSectionId> =
    signal<SettingsSectionId>('application');

  /**
   * Holds the language whose server settings are on show. Every Language Providers leaf shares one
   * section, differing only in the language it is about, so the selected language is tracked here
   * rather than encoded in a section id per language.
   */
  private readonly selectedLanguage: WritableSignal<string> = signal<string>('');

  /**
   * Gets the language whose server settings are on show, for the content pane.
   */
  protected readonly activeLanguage: Signal<string> = this.selectedLanguage.asReadonly();

  /**
   * Gets the display name of the language whose server settings are on show.
   */
  protected readonly activeLanguageName: Signal<string> = computed((): string =>
    languageDisplayName(this.selectedLanguage()),
  );

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
   * Gets the settings navigation tree, in display order, each root in one of the groups headed in the
   * tree (see {@link SETTINGS_GROUPS}). A setting lives with the thing it changes, wherever that thing
   * appears: code settings apply wherever code is shown, terminal settings to every terminal, version
   * control settings to every repository. Single-section roots carry one "General" leaf; Keyboard,
   * Providers and Languages leaves are added from what is installed.
   */
  private readonly staticSections: readonly SettingsNavNode[] = [
    {
      id: 'application',
      group: 'studio',
      label: 'Application',
      icon: Icon.APPLICATION,
      children: [
        { id: 'application-general', label: 'General', sectionId: 'application' },
        { id: 'application-accessibility', label: 'Accessibility', sectionId: 'accessibility' },
        { id: 'application-notifications', label: 'Notifications', sectionId: 'notifications' },
        { id: 'application-security', label: 'Privacy & Content', sectionId: 'security' },
        // The app-wide shortcuts; each root's own are on a Keyboard leaf under it.
        { id: 'application-keyboard', label: 'Keyboard', sectionId: 'keyboard' },
      ],
    },
    {
      id: 'ai',
      group: 'studio',
      label: 'Artificial Intelligence',
      icon: Icon.AGENT,
      children: [
        { id: 'ai-general', label: 'General', sectionId: 'ai' },
        { id: 'ai-security-leaf', label: 'Security & Permissions', sectionId: 'ai-security' },
        { id: 'ai-mission-control', label: 'Mission Control', sectionId: 'mission-control' },
      ],
    },
    {
      id: 'source-control',
      group: 'studio',
      label: 'Version Control',
      icon: Icon.SOURCE_CONTROL,
      children: [{ id: 'source-control-general', label: 'General', sectionId: 'source-control' }],
    },
    {
      id: 'terminal',
      group: 'studio',
      label: 'Terminal',
      icon: Icon.TERMINAL,
      children: [{ id: 'terminal-general', label: 'General', sectionId: 'terminal' }],
    },
    {
      id: 'plugins',
      group: 'studio',
      label: 'Plugins',
      icon: Icon.PLUGINS,
      children: [{ id: 'plugins-general', label: 'General', sectionId: 'plugins' }],
    },
    {
      // Code wherever it appears: editor tabs, diffs, database queries, request bodies, Markdown code
      // blocks. Its Languages branch is added from the installed language servers.
      id: 'code',
      group: 'documents',
      label: 'Code',
      icon: Icon.SETTINGS_TEXT_EDITOR,
      children: [
        { id: 'code-general-leaf', label: 'General', sectionId: 'code-general' },
        { id: 'code-appearance-leaf', label: 'Appearance', sectionId: 'code-appearance' },
        { id: 'code-editing-leaf', label: 'Editing', sectionId: 'code-editing' },
      ],
    },
    {
      id: 'markdown',
      group: 'documents',
      label: 'Markdown',
      icon: Icon.SETTINGS_MARKDOWN,
      children: [{ id: 'markdown-general', label: 'General', sectionId: 'markdown' }],
    },
    {
      // Images have no settings of their own yet; the root carries its Keyboard leaf alone.
      id: 'images',
      group: 'documents',
      label: 'Images',
      icon: Icon.IMAGE_FILE,
      children: [],
    },
    {
      id: 'workspaces',
      group: 'capabilities',
      label: 'Workspaces',
      icon: Icon.DIRECTORY,
      children: [{ id: 'workspaces-general', label: 'General', sectionId: 'workspaces' }],
    },
    {
      // API Explorer has no settings of its own yet; it carries its Keyboard leaf alone.
      id: 'api-explorer',
      group: 'capabilities',
      label: 'API Explorer',
      icon: Icon.API_EXPLORER,
      children: [],
    },
    {
      id: 'database-explorer',
      group: 'capabilities',
      label: 'Database Explorer',
      icon: Icon.DATABASE,
      children: [
        { id: 'database-explorer-general', label: 'General', sectionId: 'database-explorer' },
      ],
    },
    {
      id: 'system-monitor',
      group: 'tools',
      label: 'System Monitor',
      icon: Icon.SYSTEM_MONITOR,
      children: [{ id: 'system-monitor-general', label: 'General', sectionId: 'system-monitor' }],
    },
  ];

  /**
   * Gets the navigation tree, with the AI Providers and Code Languages branches built from what is
   * installed.
   */
  protected readonly sections: Signal<readonly SettingsNavNode[]> = computed(
    (): readonly SettingsNavNode[] =>
      // Leaves before branches: each root's Keyboard leaf comes before its Providers or Languages
      // branch, so the branch's open list of entries never pushes the root's own pages out of sight.
      this.withLanguageProviderPages(
        this.withProviderPages(this.withKeyboardPages(this.staticSections)),
      ).filter((node: SettingsNavNode): boolean => (node.children?.length ?? 1) > 0),
  );

  /**
   * Puts a Keyboard leaf under each root whose capability has catalogued shortcuts, built from the
   * catalogue so a capability with none (or not installed) gets no empty page. A root left with no
   * children at all — API Explorer or Image Viewer when their shortcuts are absent — is dropped by
   * {@link sections}.
   * @param sections The sections.
   * @returns Returns the sections with the Keyboard leaves appended.
   */
  private withKeyboardPages(sections: readonly SettingsNavNode[]): readonly SettingsNavNode[] {
    const views: ReadonlySet<string> = new Set<string>(
      this.keybindings.resolvedCatalogue().map((binding: ResolvedBinding): string => binding.view),
    );
    return sections.map((node: SettingsNavNode): SettingsNavNode => {
      const view: string | undefined = KEYBOARD_PAGES[node.id];
      if (view === undefined || !views.has(view)) {
        return node;
      }
      return {
        ...node,
        children: [
          ...(node.children ?? []),
          {
            id: `${node.id}-keyboard`,
            label: 'Keyboard',
            sectionId: `keyboard-${node.id}`,
            keyboardView: view,
          },
        ],
      };
    });
  }

  /**
   * Puts the Languages branch into the Code root, built from the languages the
   * installed server plugins serve.
   *
   * The branch carries a leaf per language that has an installed server, rather than one page listing
   * every server Studio knows about. A language nobody has installed support for is not a setting with
   * nothing to say — it is a plugin to install, which is the Plugin Manager's business — so it does not
   * appear here at all, and the branch itself disappears when nothing is installed. Each leaf carries
   * both halves of what Studio does for a language: which server serves it, and how the editor behaves
   * in its files.
   * @param sections The sections.
   * @returns Returns the sections with the branch inserted, or unchanged when nothing is installed.
   */
  private withLanguageProviderPages(
    sections: readonly SettingsNavNode[],
  ): readonly SettingsNavNode[] {
    const languages: readonly string[] = this.lspSettings.installedLanguages();
    if (languages.length === 0) {
      return sections;
    }
    return sections.map((node: SettingsNavNode): SettingsNavNode =>
      node.id === 'code'
        ? {
            ...node,
            children: [
              ...(node.children ?? []),
              {
                id: 'language-providers',
                label: 'Languages',
                children: languages.map((language: string): SettingsNavNode => ({
                  id: `language-providers-${language}`,
                  label: languageDisplayName(language),
                  sectionId: 'language-providers',
                  language,
                })),
              },
            ],
          }
        : node,
    );
  }

  /**
   * Puts the Providers branch into the AI section, built from the providers installed harnesses
   * contribute.
   *
   * ⛔ On exactly the rule the Languages branch follows, and for the same reason. A company with
   * no installed harness is not a settings page with nothing to say — it is a plugin to install, which
   * is the Plugin Manager's business. So the branch carries a leaf per contributed provider and
   * disappears entirely when none is installed, which is what a fresh binary now shows (#653).
   * @param sections The static sections.
   * @returns Returns the sections with the branch inserted, or unchanged when nothing is contributed.
   */
  private withProviderPages(sections: readonly SettingsNavNode[]): readonly SettingsNavNode[] {
    const pages: readonly ProviderPage[] = this.providers.pages();
    if (pages.length === 0) {
      return sections;
    }
    return sections.map((node: SettingsNavNode): SettingsNavNode =>
      node.id === 'ai'
        ? {
            ...node,
            children: [
              ...(node.children ?? []),
              {
                id: 'ai-providers',
                label: 'Providers',
                children: pages.map((page: ProviderPage): SettingsNavNode => ({
                  id: `ai-provider-${page.id}`,
                  label: page.label,
                  sectionId: `ai-provider-${page.id}`,
                })),
              },
            ],
          }
        : node,
    );
  }

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
   * Gets the provider page the selected section names, or null when the selection is not a provider
   * page. The pages are the open set an installed harness contributes, so the template resolves them
   * by prefix rather than by naming each company.
   */
  protected readonly selectedProvider: Signal<string | null> = computed((): string | null => {
    const section: string = this.section();
    return section.startsWith('ai-provider-') ? section.slice('ai-provider-'.length) : null;
  });

  /**
   * Gets the keyboard catalogue view a capability's Keyboard leaf shows, or null when the selection
   * is not one.
   */
  protected readonly selectedKeyboardView: Signal<string | null> = computed((): string | null => {
    const path: readonly SettingsNavNode[] | null = this.pathToSection(this.section());
    return path?.[path.length - 1].keyboardView ?? null;
  });

  /**
   * Gets the breadcrumb trail shown above the content pane: the labels along the path to the selected
   * leaf (for example ["Application", "General"] or ["Artificial Intelligence", "Providers",
   * "Anthropic"]), rendered as static, non-clickable crumbs.
   */
  protected readonly selectedTrail: Signal<readonly string[]> = computed((): readonly string[] => {
    // Every language's page shares one section, so the trail is found by the selected row rather than
    // the section — by the section it was always the first language's.
    const language: string = this.selectedLanguage();
    const path: readonly SettingsNavNode[] | null =
      this.section() === 'language-providers' && language !== ''
        ? this.pathToNode(`language-providers-${language}`)
        : this.pathToSection(this.section());
    return path === null ? [] : path.map((node: SettingsNavNode): string => node.label);
  });

  /**
   * Finds the path of nodes from a root down to the node with the given id.
   * @param id The node's id.
   * @param nodes The nodes to search (the whole tree by default).
   * @param trail The nodes accumulated on the way down (empty at the root).
   * @returns Returns the path root→node, or null when no node has that id.
   */
  private pathToNode(
    id: string,
    nodes: readonly SettingsNavNode[] = this.sections(),
    trail: readonly SettingsNavNode[] = [],
  ): readonly SettingsNavNode[] | null {
    for (const node of nodes) {
      const next: readonly SettingsNavNode[] = [...trail, node];
      if (node.id === id) {
        return next;
      }
      const found: readonly SettingsNavNode[] | null =
        node.children === undefined ? null : this.pathToNode(id, node.children, next);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  /**
   * Gets the flattened navigation rows: every node in order, indented by depth, with a branch's children
   * following it only while it is expanded.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const words: readonly string[] = this.queryWords();
    const nodes: readonly SettingsNavNode[] =
      words.length === 0 ? this.sections() : this.matchingNodes(this.sections(), [], words);
    // While searching, every branch left standing holds a match, so all of them are open: a match
    // tucked inside a collapsed branch is a match the user cannot see. The user's own expansion is
    // left alone underneath and is what they get back when the query is cleared.
    const expanded: ReadonlySet<string> =
      words.length === 0 ? this.expandedNodes() : this.branchIds(nodes);
    const rows: TreeRow[] = [];
    // A heading opens each group of roots. Groups follow one another in order, so a heading is due
    // wherever a root's group differs from the last; while searching, a group with no match left has
    // no roots and so no heading.
    let group: SettingsGroupId | undefined;
    for (const root of nodes) {
      if (root.group !== undefined && root.group !== group) {
        group = root.group;
        rows.push({
          id: `group-${group}`,
          depth: 0,
          expandable: false,
          expanded: false,
          data: null,
          heading: SETTINGS_GROUPS[group],
        });
      }
      this.appendRows([root], 0, expanded, rows);
    }
    return rows;
  });

  /**
   * Holds the text typed into the search box above the tree.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the search query split into lower-cased words; empty when there is no query.
   */
  private readonly queryWords: Signal<readonly string[]> = computed((): readonly string[] =>
    this.query()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter((word: string): boolean => word !== ''),
  );

  /**
   * Gets a value indicating whether a search is in force and nothing matches it.
   */
  protected readonly noMatches: Signal<boolean> = computed(
    (): boolean => this.queryWords().length > 0 && this.rows().length === 0,
  );

  /**
   * Prunes the tree to the leaves a search matches, keeping each one's ancestors so it stays in place.
   * A branch survives only while something beneath it matches.
   * @param nodes The nodes to prune.
   * @param trail The ancestors of the nodes (empty at the root).
   * @param words The lower-cased query words.
   * @returns Returns the pruned nodes.
   */
  private matchingNodes(
    nodes: readonly SettingsNavNode[],
    trail: readonly SettingsNavNode[],
    words: readonly string[],
  ): readonly SettingsNavNode[] {
    const kept: SettingsNavNode[] = [];
    for (const node of nodes) {
      if (node.children === undefined) {
        if (this.leafMatches(node, trail, words)) {
          kept.push(node);
        }
        continue;
      }
      const children: readonly SettingsNavNode[] = this.matchingNodes(
        node.children,
        [...trail, node],
        words,
      );
      if (children.length > 0) {
        kept.push({ ...node, children });
      }
    }
    return kept;
  }

  /**
   * Determines whether a leaf matches a search: every word must appear somewhere in the leaf's own
   * label, its ancestors' labels, or the titles and descriptions of the settings on its page — so
   * "font size" finds Code › Appearance, and "terminal" finds the leaf under Terminal.
   * @param leaf The leaf.
   * @param trail The leaf's ancestors.
   * @param words The lower-cased query words.
   * @returns Returns true when the leaf matches.
   */
  private leafMatches(
    leaf: SettingsNavNode,
    trail: readonly SettingsNavNode[],
    words: readonly string[],
  ): boolean {
    const group: SettingsGroupId | undefined = trail[0]?.group;
    const text: string = [
      ...(group === undefined ? [] : [SETTINGS_GROUPS[group]]),
      ...trail.map((node: SettingsNavNode): string => node.label),
      leaf.label,
      ...this.settingsOnPage(leaf)
        .filter(appliesToPlatform)
        .flatMap((setting: SettingDef): string[] => [setting.title, setting.description]),
      ...this.shortcutsOnPage(leaf),
    ]
      .join('\n')
      .toLocaleLowerCase();
    return words.every((word: string): boolean => text.includes(word));
  }

  /**
   * Finds the registry settings a leaf's page shows, for the search to match against.
   *
   * Most pages render one registry section of the same id. The AI pages split the one `ai` section
   * between them (see {@link AI_PAGE_KEYS}), and a language's page shows the editor settings a language
   * may override. Pages built by hand from settings the registry does not hold — Version Control, a
   * language's server rows, the provider pages — have none, and are found by their names alone.
   * @param leaf The leaf.
   * @returns Returns the settings on the leaf's page.
   */
  private settingsOnPage(leaf: SettingsNavNode): readonly SettingDef[] {
    if (leaf.sectionId === undefined) {
      return [];
    }
    if (leaf.sectionId === 'language-providers') {
      return codeSettings().filter(
        (setting: SettingDef): boolean => setting.profileOverridable === true,
      );
    }
    if (leaf.sectionId === 'source-control') {
      return VERSION_CONTROL_SECTIONS.flatMap(
        (id: string): readonly SettingDef[] => findSection(id)?.settings ?? [],
      );
    }
    const keys: ReadonlySet<string> | undefined = AI_PAGE_KEYS[leaf.sectionId];
    if (keys !== undefined) {
      return (findSection('ai')?.settings ?? []).filter((setting: SettingDef): boolean =>
        keys.has(setting.key),
      );
    }
    return findSection(leaf.sectionId)?.settings ?? [];
  }

  /**
   * Finds the shortcut descriptions a Keyboard leaf shows, so "zoom in" finds Image Viewer › Keyboard.
   * @param leaf The leaf.
   * @returns Returns the descriptions, or none for a leaf that is not a Keyboard page.
   */
  private shortcutsOnPage(leaf: SettingsNavNode): readonly string[] {
    const application: boolean = leaf.sectionId === 'keyboard';
    if (leaf.keyboardView === undefined && !application) {
      return [];
    }
    return this.keybindings
      .resolvedCatalogue()
      .filter((binding: ResolvedBinding): boolean =>
        application ? binding.global : binding.view === leaf.keyboardView,
      )
      .map((binding: ResolvedBinding): string => `${binding.description} shortcut`);
  }

  /**
   * Collects the ids of every branch in a tree.
   * @param nodes The nodes.
   * @returns Returns the branch ids.
   */
  private branchIds(nodes: readonly SettingsNavNode[]): ReadonlySet<string> {
    const ids: Set<string> = new Set<string>();
    const visit: (list: readonly SettingsNavNode[]) => void = (
      list: readonly SettingsNavNode[],
    ): void => {
      for (const node of list) {
        if (node.children !== undefined) {
          ids.add(node.id);
          visit(node.children);
        }
      }
    };
    visit(nodes);
    return ids;
  }

  /**
   * Gets the id of the selected navigation row: the leaf whose content is on show, or null when none.
   */
  protected readonly selectedRowId: Signal<string | null> = computed((): string | null => {
    // The Language Providers leaves all show the same section and differ only by language, so the
    // selected row is the one whose language matches rather than simply the first leaf found.
    const language: string = this.selectedLanguage();
    if (this.section() === 'language-providers' && language !== '') {
      return `language-providers-${language}`;
    }
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
      if (data.language !== undefined) {
        this.selectedLanguage.set(data.language);
      }
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
          language: node.language,
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
    nodes: readonly SettingsNavNode[] = this.sections(),
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
   * Gets the More Actions menu beside the search box: what acts on the settings as a whole.
   */
  protected readonly menuItems: readonly MenuItem[] = [
    { id: MENU_IMPORT, label: 'Import Settings', icon: Icon.DOWNLOAD },
    { id: MENU_EXPORT, label: 'Export Settings', icon: Icon.EXPORT },
  ];

  /**
   * Runs a command chosen from the More Actions menu.
   * @param id The chosen item's identifier.
   */
  protected onMenu(id: string): void {
    if (id === MENU_IMPORT) {
      void this.importSettings();
    } else if (id === MENU_EXPORT) {
      void this.exportSettings();
    }
  }

  /**
   * Exports the settings to a file the user chooses.
   */
  protected async exportSettings(): Promise<void> {
    this.log.info('settings', 'Settings export requested');
    const path: string | null = await this.transfer.exportToFile();
    if (path !== null) {
      this.notifications.notify({ severity: 'success', title: 'Settings exported', detail: path });
    }
  }

  /**
   * Reads a settings file the user chooses and asks what happens to the settings it does not
   * mention, which is a question to put each time: the answer depends on the file.
   */
  protected async importSettings(): Promise<void> {
    this.log.info('settings', 'Settings import requested');
    const read: SettingsFileRead | null = await this.transfer.readFromFile();
    if (read === null) {
      return;
    }
    if (!read.ok) {
      this.notifications.notify({
        severity: 'error',
        title: "Settings couldn't be imported",
        detail: read.error,
      });
      return;
    }
    this.pendingImport.set(read.pending);
  }

  /**
   * Applies the waiting import.
   * @param replace Whether settings the file does not mention go back to their defaults.
   */
  protected confirmImport(replace: boolean): void {
    const pending: PendingSettingsImport | null = this.pendingImport();
    if (pending === null) {
      return;
    }
    this.transfer.apply(pending, replace);
    this.pendingImport.set(null);
    this.notifications.notify({
      severity: 'success',
      title: 'Settings imported',
      detail: pending.fileName,
    });
  }

  /**
   * Drops the waiting import without applying anything.
   */
  protected cancelImport(): void {
    this.pendingImport.set(null);
  }

  /**
   * Counts the settings an import applies.
   * @param pending The checked import.
   * @returns Returns the number of settings the file sets.
   */
  protected importCount(pending: PendingSettingsImport): number {
    return this.transfer.countOf(pending);
  }

  /**
   * Relaunches the application so pending restart-gated changes can take effect.
   */
  protected relaunch(): void {
    this.log.info('settings', 'Relaunch requested from restart banner');
    this.restart.relaunch();
  }
}
