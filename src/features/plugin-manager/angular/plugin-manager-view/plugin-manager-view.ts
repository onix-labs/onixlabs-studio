import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  Signal,
  computed,
  inject,
  input,
  OnInit,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  FormatPluginContribution,
  LanguagePluginContribution,
  PluginContribution,
  PluginSlot,
  PluginSummary,
  isLanguageContribution,
} from '@shared/api/plugin-channels';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelEdge } from '@shared/angular/components/panel-layout/panel-types';
import { CategoryItem, CategoryList } from '@shared/angular/components/category-list/category-list';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { PluginAction } from '@shared/angular/components/plugin-action/plugin-action';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { canUpdate } from '@shared/angular/components/plugin-action/plugin-action-rules';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import {
  toolViewConversationContext,
  ToolViewAgentPanel,
} from '@shared/angular/components/panels/tool-view-agent-panel/tool-view-agent-panel';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { PluginManagerAgentCapabilities } from '../plugin-manager-agent/plugin-manager-agent-capabilities';
import { PluginManagerAgentPanelState } from '../plugin-manager-agent/plugin-manager-agent-panel-state';
import {
  ALL_PLUGINS,
  AVAILABLE_PLUGINS,
  INSTALLED_PLUGINS,
  PluginBrowse,
  PluginCategory,
  categoriesOf,
  rowIconForCategory,
} from '../plugin-browse/plugin-browse';
import { languageDisplayName } from '@shared/angular/services/plugins/language-names';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Sideloading } from '@shared/angular/services/plugins/sideloading';
import { SideloadingState } from '@shared/api/plugin-channels';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';

/**
 * How each slot is described where a plugin's contributions are listed.
 */
const SLOT_LABELS: Readonly<Record<PluginSlot, string>> = {
  'language-server': 'Language server',
  'debug-adapter': 'Debugger',
  decoder: 'Decoder',
  'container-engine': 'Container engine',
  'version-control': 'Version control',
  hosting: 'Code hosting',
  'agent-harness': 'AI provider',
};

/**
 * The plugin table's columns. The plugin column takes a fixed share so its name and description have
 * room; the category and languages share what is left; version, state and the action are fixed, so
 * they line up down the table however wide their text is.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'plugin', header: 'Plugin', width: '38%', sortable: true },
  { id: 'category', header: 'Category', sortable: true },
  { id: 'languages', header: 'Languages' },
  { id: 'version', header: 'Version', width: '8.5rem' },
  { id: 'state', header: 'State', width: '10.5rem', sortable: true },
  { id: 'action', header: '', width: '8.5rem', align: 'end' },
];

/**
 * The Plugin Manager: the list of plugins Studio knows about, what is installed on this machine, and
 * the controls that change that. A side panel filters the list (#950) — every plugin, the installed
 * or available ones, or a category — and the list fills the rest of the view as one table.
 *
 * This is the first of the plugin model's three layers made visible — *available* and *installed*. What
 * a plugin contributes is shown here as plain text (a Python language server, a C# debugger) because it
 * is the reason to install one; **choosing between** two installed implementations of the same thing is
 * Settings' job, and only arises once more than one is installed.
 */
@Component({
  selector: 'app-plugin-manager-view',
  imports: [
    AppIcon,
    CategoryList,
    Chip,
    NgTemplateOutlet,
    PanelLayout,
    Panel,
    PluginAction,
    Table,
    TableRowDef,
    ToolViewAgentPanel,
  ],
  // The agent and its conversation live on the VIEW, not the docked panel (#968), so a run outlives
  // the panel being closed.
  providers: [
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'plugins' },
    PluginManagerAgentCapabilities,
  ],
  templateUrl: './plugin-manager-view.html',
  styleUrl: './plugin-manager-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerView implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the table's columns.
   */
  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Publishes this view's injector while it is active, so the status strip mounts the Plugin Manager's
   * status (#882) inside it. Without it the strip has no view to mount through and names only the tab.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Registers the view's agent with Mission Control and the requests inbox for the tab's whole life.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'plugins',
  });

  /**
   * Registers the capabilities the agent acts through, for the view's life.
   */
  private readonly agentCapabilities: PluginManagerAgentCapabilities = inject(
    PluginManagerAgentCapabilities,
  );

  /**
   * Holds whether the docked agent is showing, shared with the ribbon.
   */
  protected readonly agentPanel: PluginManagerAgentPanelState = inject(
    PluginManagerAgentPanelState,
  );

  /**
   * Gets the context the Plugin Manager's conversations are filed under.
   */
  protected readonly agentContext: ConversationContext = toolViewConversationContext('plugins');

  /**
   * Publishes this view's injector to the status strip and its agent to Mission Control, now that the
   * tab id is readable.
   */
  public ngOnInit(): void {
    this.statusHost.register(this.tabId());
    this.agentHost.register(this.tabId());
  }

  /**
   * Holds the plugin client the view reads and acts through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the sideloading switch's client, read for whether plugins placed by hand were left out.
   */
  private readonly sideloading: Sideloading = inject(Sideloading);

  /**
   * Gets the browsing state: the search text, the side panel's filter and the column sort.
   */
  protected readonly browse: PluginBrowse = inject(PluginBrowse);

  /**
   * Gets the table's columns.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Gets the edges the side panel may sit on: only its own, since it is part of the view.
   */
  protected readonly sideEdges: readonly PanelEdge[] = ['left'];

  /**
   * Gets the table's rows, one per plugin the filter and search leave, in the chosen order.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.browse
      .visible()
      .map((plugin: PluginSummary): TableRow => ({ id: plugin.id, data: plugin })),
  );

  /**
   * Gets the side panel's filters: every plugin, the installed and the available ones, then each
   * category, every one with how many plugins it holds.
   */
  protected readonly filterItems: Signal<readonly CategoryItem[]> = computed(
    (): readonly CategoryItem[] => [
      {
        id: ALL_PLUGINS,
        label: 'All Plugins',
        icon: Icon.PLUGINS,
        count: this.browse.all().length,
      },
      {
        id: INSTALLED_PLUGINS,
        label: 'Installed',
        icon: Icon.CHECK,
        count: this.browse.installedCount(),
      },
      {
        id: AVAILABLE_PLUGINS,
        label: 'Available',
        icon: Icon.DOWNLOAD,
        count: this.browse.notInstalledCount(),
      },
      ...this.browse.categories().map((category: PluginCategory, index: number): CategoryItem => ({
        id: category.name,
        label: category.name,
        icon: category.icon,
        count: category.count,
        dividerBefore: index === 0,
      })),
    ],
  );

  /**
   * Gets the heading, which names the selected category so the list always says what it is showing.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    switch (this.browse.filter()) {
      case ALL_PLUGINS:
        return 'All Plugins';
      case INSTALLED_PLUGINS:
        return 'Installed Plugins';
      case AVAILABLE_PLUGINS:
        return 'Available Plugins';
      default:
        return this.browse.filter();
    }
  });

  /**
   * Gets the sentence under the heading: how many plugins are listed, and where choosing between two
   * that provide the same thing happens — which is the one thing this view deliberately does not do.
   * When plugins placed in the plugins folder by hand were left out this launch (#979), it says so and
   * where to turn them on, since otherwise they would simply be missing with no reason given.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const shown: number = this.browse.visible().length;
    const noun: string = shown === 1 ? 'plugin' : 'plugins';
    const scope: string = this.browse.narrowed() ? 'match your filters' : 'available';
    const summary: string = `${shown} ${noun} ${scope}. Where two installed plugins provide the same thing, choose between them in Settings.`;
    const sideloading: SideloadingState = this.sideloading.state();
    if (sideloading.inForce || sideloading.skipped === 0) {
      return summary;
    }
    const skipped: string =
      sideloading.skipped === 1
        ? '1 plugin placed in the plugins folder by hand was not loaded'
        : `${sideloading.skipped} plugins placed in the plugins folder by hand were not loaded`;
    const remedy: string = sideloading.enabled
      ? 'restart Studio to load them'
      : 'turn on Load sideloaded plugins in Settings to load them';
    return `${summary} ${skipped}: ${remedy}.`;
  });

  /**
   * Gets the last action's error, or null.
   */
  protected readonly error: Signal<string | null> = this.plugins.error;

  /**
   * Reads a table row's plugin payload. The table hands its templates the {@link TableRow} wrapper, not
   * the payload, so the cast has to go through `data` — casting the wrapper itself compiles and yields
   * an object whose every field is undefined, which renders as a row of empty cells.
   * @param row The table row.
   * @returns Returns the row's plugin.
   */
  protected plugin(row: TableRow): PluginSummary {
    return row.data as PluginSummary;
  }

  /**
   * Gets the total number of known plugins, for the summary line.
   */
  protected total(): number {
    return this.plugins.plugins().length;
  }

  /**
   * Describes what kind of thing a plugin contributes, without repeating the languages beside it.
   * @param plugin The plugin.
   * @returns Returns the distinct slot labels it fills.
   */
  protected provides(plugin: PluginSummary): string {
    const kinds: readonly string[] = [
      ...new Set(
        plugin.contributions.map(
          (contribution: PluginContribution): string => SLOT_LABELS[contribution.slot],
        ),
      ),
    ];
    return kinds.join(', ');
  }

  /**
   * Names the languages a plugin serves, in the words a person uses for them rather than the
   * identifiers Monaco does.
   * @param plugin The plugin.
   * @returns Returns the language names, then any formats.
   */
  protected languages(plugin: PluginSummary): readonly string[] {
    const languages: readonly string[] = [
      ...new Set(
        plugin.contributions
          .filter(isLanguageContribution)
          .flatMap(
            (contribution: LanguagePluginContribution): readonly string[] => contribution.languages,
          ),
      ),
    ];
    // A decoder is keyed by format rather than language, so its formats are listed alongside the
    // language names rather than being silently dropped from the column.
    const formats: readonly string[] = [
      ...new Set(
        plugin.contributions
          .filter(
            (contribution: PluginContribution): contribution is FormatPluginContribution =>
              contribution.slot === 'decoder',
          )
          .flatMap(
            (contribution: FormatPluginContribution): readonly string[] => contribution.formats,
          ),
      ),
    ];
    return [...languages.map(languageDisplayName), ...formats];
  }

  /**
   * Gets whether a newer version is waiting, exposed for the state badge.
   */
  protected readonly canUpdate: typeof canUpdate = canUpdate;

  /**
   * Gets a plugin's categories as one readable phrase.
   * @param plugin The plugin.
   * @returns Returns the categories, comma-separated.
   */
  protected categories(plugin: PluginSummary): string {
    return categoriesOf(plugin).join(', ');
  }

  /**
   * Gets the glyph a row is drawn with: the icon of the category it falls under, at the light weight
   * the rows use.
   * @param plugin The plugin.
   * @returns Returns the icon.
   */
  protected iconFor(plugin: PluginSummary): Icon {
    return rowIconForCategory(categoriesOf(plugin)[0]);
  }

  /**
   * Gets the word shown in a row's state badge.
   * @param plugin The plugin.
   * @returns Returns the label.
   */
  protected stateLabel(plugin: PluginSummary): string {
    if (plugin.state === 'installed') {
      return canUpdate(plugin) ? 'Update available' : 'Installed';
    }
    if (plugin.state === 'busy') {
      return 'Working…';
    }
    return plugin.state === 'available' ? 'Not installed' : 'Not supported';
  }

  /**
   * Gets the tone of a row's state chip: each state in the semantic colour that already means it
   * everywhere else in the application.
   * @param plugin The plugin.
   * @returns Returns the tone.
   */
  protected stateTone(plugin: PluginSummary): ChipTone {
    if (plugin.state === 'installed') {
      return canUpdate(plugin) ? 'info' : 'success';
    }
    if (plugin.state === 'busy') {
      // Not a colour of its own: the work is transient, and a colour would imply an outcome.
      return 'neutral';
    }
    return plugin.state === 'available' ? 'warning' : 'danger';
  }

  /**
   * Gets the icon shown in a row's state chip.
   * @param plugin The plugin.
   * @returns Returns the icon.
   */
  protected stateIcon(plugin: PluginSummary): Icon {
    if (plugin.state === 'installed') {
      return canUpdate(plugin) ? Icon.INFO_FILL : Icon.CHECK_CIRCLE_FILL;
    }
    if (plugin.state === 'unavailable') {
      return Icon.WARNING_CIRCLE_FILL;
    }
    return Icon.DOWNLOAD_CIRCLE_FILL;
  }
}
