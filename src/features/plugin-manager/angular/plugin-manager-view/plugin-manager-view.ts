import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  Signal,
  WritableSignal,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  FormatPluginContribution,
  LanguagePluginContribution,
  PluginContribution,
  PluginSlot,
  PluginSummary,
  isLanguageContribution,
} from '@shared/api/plugin-channels';
import { Icon } from '@shared/angular/icons/icon';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { languageDisplayName } from '@shared/angular/services/plugins/language-names';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The plugin table's columns.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Plugin' },
  { id: 'provides', header: 'Provides', width: '11rem' },
  { id: 'languages', header: 'Languages', width: '20%' },
  { id: 'version', header: 'Version', width: '10rem' },
  { id: 'state', header: 'Status', width: '11rem' },
  { id: 'actions', header: '', width: '9rem', align: 'end' },
];

/**
 * How each slot is described where a plugin's contributions are listed.
 */
const SLOT_LABELS: Readonly<Record<PluginSlot, string>> = {
  'language-server': 'Language server',
  'debug-adapter': 'Debugger',
  decoder: 'Decoder',
  'container-engine': 'Container engine',
};

/**
 * The Plugin Manager: the list of plugins Studio knows about, what is installed on this machine, and
 * the controls that change that.
 *
 * This is the first of the plugin model's three layers made visible — *available* and *installed*. What
 * a plugin contributes is shown here as plain text (a Python language server, a C# debugger) because it
 * is the reason to install one; **choosing between** two installed implementations of the same thing is
 * Settings' job, and only arises once more than one is installed.
 */
@Component({
  selector: 'app-plugin-manager-view',
  imports: [Button, AppIcon, Table, TableRowDef, TextField],
  templateUrl: './plugin-manager-view.html',
  styleUrl: './plugin-manager-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the table's columns.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the plugin client the view reads and acts through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the filter text. Not persisted: a filter is what the user is doing right now, and finding a
   * list mysteriously filtered on the next visit is worse than retyping four characters.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the plugins matching the filter, installed first so what is in use leads.
   */
  private readonly matching: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => {
      const terms: readonly string[] = this.query().toLowerCase().split(/\s+/).filter(Boolean);
      return [...this.plugins.plugins()]
        .filter((plugin: PluginSummary): boolean => matches(plugin, terms))
        .sort(
          (left: PluginSummary, right: PluginSummary): number =>
            Number(right.state === 'installed') - Number(left.state === 'installed'),
        );
    },
  );

  /**
   * Gets the matching plugins adapted to the table's row shape.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.matching().map((plugin: PluginSummary): TableRow => ({ id: plugin.id, data: plugin })),
  );

  /**
   * Gets whether a filter is narrowing the list, so the empty state can say which of the two nothings
   * this is: no plugins at all, or none matching what was typed.
   */
  protected readonly filtered: Signal<boolean> = computed(
    (): boolean => this.query().trim() !== '',
  );

  /**
   * Gets how many plugins are installed, for the summary line.
   */
  protected readonly installedCount: Signal<number> = computed(
    (): number =>
      this.plugins
        .plugins()
        .filter((plugin: PluginSummary): boolean => plugin.state === 'installed').length,
  );

  /**
   * Gets whether an operation is in flight.
   */
  protected readonly busy: Signal<boolean> = this.plugins.busy;

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
   * Clears the filter, so the list returns to everything.
   */
  protected clearQuery(): void {
    this.query.set('');
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
   * @returns Returns the language names.
   */
  protected languages(plugin: PluginSummary): string {
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
    return [...languages.map(languageDisplayName), ...formats].join(', ');
  }

  /**
   * Gets whether the plugin can be installed from here.
   * @param plugin The plugin.
   * @returns Returns true when an Install action applies.
   */
  protected canInstall(plugin: PluginSummary): boolean {
    return plugin.state === 'available';
  }

  /**
   * Gets whether the plugin can be removed from here. Every installed plugin can — that is what makes
   * it a plugin rather than part of the application.
   * @param plugin The plugin.
   * @returns Returns true when a Remove action applies.
   */
  protected canUninstall(plugin: PluginSummary): boolean {
    return plugin.state === 'installed';
  }

  /**
   * Gets whether a newer version is waiting.
   *
   * The installed version is what the user accepted; a catalogue that has moved on does not get to
   * arrive without being asked. So this is an offer, not a state the plugin drifts into.
   * @param plugin The plugin.
   * @returns Returns true when what is installed is not what the catalogue now offers.
   */
  protected canUpdate(plugin: PluginSummary): boolean {
    return (
      plugin.state === 'installed' &&
      plugin.installedVersion !== null &&
      plugin.installedVersion !== plugin.version
    );
  }

  /**
   * Installs, after the terms have been accepted.
   *
   * Verification proves a payload has not been *tampered with*; it has never claimed the code is good,
   * and for a dependency tree the code arrives from many more people than the one named on the entry.
   * That residual risk is the user's to accept, so it is put in front of them rather than assumed —
   * by the shared consent seam, so every other entry point to an install asks the same way.
   * @param plugin The plugin to install.
   */
  protected install(plugin: PluginSummary): void {
    void this.plugins.installWithConsent(plugin.id);
  }

  /**
   * Updates, after the terms have been accepted again. An update is new code from the same publisher,
   * which is the same thing being accepted as at install — so it is asked the same way rather than
   * waved through.
   * @param plugin The plugin to update.
   */
  protected update(plugin: PluginSummary): void {
    void this.plugins.installWithConsent(plugin.id);
  }

  /**
   * Removes a plugin.
   * @param plugin The plugin to remove.
   */
  protected uninstall(plugin: PluginSummary): void {
    void this.plugins.uninstall(plugin.id);
  }
}

/**
 * Gets what a contribution is keyed by, whichever way its slot is keyed.
 *
 * A container engine is keyed by nothing at all — it is chosen once for the application — so it
 * contributes no keys to search on, and its display name alone has to carry it.
 * @param contribution The contribution.
 * @returns Returns the keys, empty for an unkeyed slot.
 */
function contributionKeys(contribution: PluginContribution): readonly string[] {
  if (isLanguageContribution(contribution)) {
    return contribution.languages;
  }
  return contribution.slot === 'decoder' ? contribution.formats : [];
}

/**
 * Determines whether a plugin matches every search term.
 *
 * Every term must match, but each may match any field — so "python debug" finds a Python debugger
 * without the user knowing which field holds which word. Matching is over what the table actually
 * shows, plus the identifier: a filter that hides a row whose visible text contains the query would
 * read as a bug.
 * @param plugin The plugin to test.
 * @param terms The lower-cased search terms, empty when nothing is typed.
 * @returns Returns true when the plugin matches.
 */
function matches(plugin: PluginSummary, terms: readonly string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack: string = [
    plugin.name,
    plugin.description,
    plugin.id,
    plugin.detail ?? '',
    ...plugin.contributions.flatMap((contribution: PluginContribution): readonly string[] => [
      contribution.displayName,
      ...contributionKeys(contribution),
    ]),
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term: string): boolean => haystack.includes(term));
}
