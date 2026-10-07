import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { CloneLayout, CloneOutcome } from '@shared/api/clone-channels';
import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type {
  HostedAccount as ProtocolAccount,
  HostedRepository as ProtocolRepository,
} from '@shared/api/hosting-protocol';
import { installedContributions } from '@shared/api/plugin-channels';
import { Clone } from '@shared/angular/services/clone/clone';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Forge } from '@shared/angular/services/forge/forge';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';

export type { CloneLayout } from '@shared/api/clone-channels';

/**
 * A collapsible section of the sidebar.
 */
export type SourceSection = 'clone' | 'accounts';

/**
 * An account the user acts as on a code host — themselves or an organisation — listed through the
 * hosting plugin that serves the host.
 */
export interface HostedAccount {
  /**
   * Gets the account's id, unique across hosts: `host/login`.
   */
  readonly id: string;

  /**
   * Gets the host's name as its plugin calls it, e.g. "GitHub".
   */
  readonly host: string;

  /**
   * Gets the account's user or organisation name.
   */
  readonly login: string;
}

/**
 * A repository an account can reach.
 *
 * The optional fields are the ones a hosting plugin may not supply: a browse view or a detail that
 * reads one only appears once some repository carries it, so nothing claims a fact Studio was never
 * told.
 */
export interface HostedRepository {
  /**
   * Gets the repository's id, unique across hosts: `host/owner/name`.
   */
  readonly id: string;

  /**
   * Gets the account it was listed through.
   */
  readonly accountId: string;

  /**
   * Gets its name.
   */
  readonly name: string;

  /**
   * Gets its owner and name, e.g. "matthew/onixlabs-aero".
   */
  readonly fullName: string;

  /**
   * Gets its description, or empty.
   */
  readonly description: string;

  /**
   * Gets when it was last updated (epoch ms).
   */
  readonly updatedAt: number;

  /**
   * Gets a value indicating whether it is private.
   */
  readonly private: boolean;

  /**
   * Gets the URL it clones from.
   */
  readonly cloneUrl: string;

  /**
   * Gets its default branch, when the host says.
   */
  readonly defaultBranch?: string;

  /**
   * Gets its main language, when the host says.
   */
  readonly language?: string | null;

  /**
   * Gets its star count, when the host says.
   */
  readonly stars?: number;

  /**
   * Gets whether it is a fork, when the host says.
   */
  readonly fork?: boolean;

  /**
   * Gets whether it is archived, when the host says.
   */
  readonly archived?: boolean;

  /**
   * Gets whether the user starred it, when the host says.
   */
  readonly starred?: boolean;
}

/**
 * A host a hosting plugin serves that is not signed in, so its accounts cannot be listed yet.
 */
interface SignedOutHost {
  /**
   * Gets the host, e.g. "github.com".
   */
  readonly host: string;

  /**
   * Gets the plugin's name for it, e.g. "GitHub".
   */
  readonly provider: string;
}

/**
 * A view of the repository browser.
 */
type BrowseView = 'all' | 'starred' | 'recent' | 'private' | 'forks' | 'archived';

/**
 * Describes a browse view in the repository filter.
 */
interface BrowseEntry {
  /**
   * Gets the view.
   */
  readonly view: BrowseView;

  /**
   * Gets its label.
   */
  readonly label: string;
}

/**
 * How recently a repository must have been updated to count as recent.
 */
const RECENT_MS: number = 30 * 24 * 60 * 60 * 1000;

/**
 * Accepts the shapes a clone URL takes: https, ssh (`git@host:owner/repo`) and `ssh://`.
 */
const CLONE_URL: RegExp = /^(https?:\/\/\S+\/\S+|ssh:\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/;

/**
 * The folder names a clone may create: one plain name.
 */
const FOLDER_NAME: RegExp = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * The welcome screen's Source Control section: "I want to find or bring existing code into Studio"
 * (#805). Clone a repository by its URL or from the list — choosing first whether it lands as a flat
 * working copy or as a worktree container — or browse the repositories of every account the installed
 * hosting plugins are signed in to.
 *
 * Core is UI only: the repositories come from the hosting plugins, the clone is made by the
 * version-control plugin, and where it goes is a folder the user chose in the main process's own
 * dialog. With neither kind of plugin installed, each part says what to install.
 */
@Component({
  selector: 'app-welcome-source-control',
  imports: [AppIcon, Dropdown],
  templateUrl: './welcome-source-control.html',
  styleUrl: './welcome-source-control.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeSourceControl implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Emits the kind of tab an action asks for; the welcome screen opens it and steps aside.
   */
  public readonly openTab: OutputEmitterRef<TabType> = output<TabType>();

  /**
   * Emits when a clone was opened, so the welcome screen steps aside.
   */
  public readonly opened: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the forge client, through which the hosting plugins are asked.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds the clone client.
   */
  private readonly cloner: Clone = inject(Clone);

  /**
   * Holds the file opener, which opens the clone as a workspace and records it as recent.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the plugin client, read for which kinds of plugin are installed.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets every browse view, in order. The ones whose data no repository carries are not offered.
   */
  private readonly allViews: readonly BrowseEntry[] = [
    { view: 'all', label: 'All Repositories' },
    { view: 'starred', label: 'Starred' },
    { view: 'recent', label: 'Recent' },
    { view: 'private', label: 'Private' },
    { view: 'forks', label: 'Forks' },
    { view: 'archived', label: 'Archived' },
  ];

  /**
   * Gets whether a version-control plugin, which makes the clone, is installed.
   */
  protected readonly canClone: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'version-control').length > 0,
  );

  /**
   * Gets whether a hosting plugin, which lists repositories, is installed.
   */
  protected readonly canBrowse: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'hosting').length > 0,
  );

  /**
   * Holds the accounts the signed-in hosts list.
   */
  protected readonly accounts: WritableSignal<readonly HostedAccount[]> = signal<
    readonly HostedAccount[]
  >([]);

  /**
   * Holds the hosts that are served but not signed in.
   */
  protected readonly signedOut: WritableSignal<readonly SignedOutHost[]> = signal<
    readonly SignedOutHost[]
  >([]);

  /**
   * Holds the repositories the accounts can reach.
   */
  protected readonly repositories: WritableSignal<readonly HostedRepository[]> = signal<
    readonly HostedRepository[]
  >([]);

  /**
   * Holds the repositories the user starred that are not among their own, collaborator or
   * organisation repositories: other people's projects, offered in the Starred view only, so they do
   * not crowd the user's own list.
   */
  protected readonly starredElsewhere: WritableSignal<readonly HostedRepository[]> = signal<
    readonly HostedRepository[]
  >([]);

  /**
   * Holds which sidebar section is open, or null when all are collapsed. At most one is open, as in the
   * original welcome screen's Get Started and Tools; Clone, the first, starts open.
   */
  protected readonly openSection: WritableSignal<SourceSection | null> =
    signal<SourceSection | null>('clone');

  /**
   * Holds whether the accounts and repositories are being read.
   */
  protected readonly loading: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds why the last read failed for some account, or null.
   */
  protected readonly loadError: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the URL typed into the clone field.
   */
  protected readonly cloneUrl: WritableSignal<string> = signal<string>('');

  /**
   * Holds how the repository will be laid out once cloned, or null until the user picks. Studio has
   * no default of its own: the layout is the user's choice, made before cloning, so the field starts
   * on "Clone As…" and Clone waits for an answer.
   */
  protected readonly layout: WritableSignal<CloneLayout | null> = signal<CloneLayout | null>(null);

  /**
   * Gets the layout choices.
   */
  protected readonly layoutOptions: readonly DropdownOption[] = [
    { value: 'flat', label: 'Flat Repository' },
    { value: 'worktree', label: 'Worktree Repository' },
  ];

  /**
   * Holds whether a clone is running.
   */
  protected readonly cloning: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds why the last clone failed, or null.
   */
  protected readonly cloneError: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the browse view.
   */
  protected readonly view: WritableSignal<BrowseView> = signal<BrowseView>('all');

  /**
   * Holds the host filter: an account's host, or null for every host.
   */
  protected readonly host: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the repository search.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds the repository shown in the detail panel, or null for none.
   */
  protected readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets a value indicating whether the clone field holds something that looks like a clone URL.
   */
  protected readonly urlValid: Signal<boolean> = computed((): boolean =>
    CLONE_URL.test(this.cloneUrl().trim()),
  );

  /**
   * Gets the folder name the clone will be given: the URL's last part.
   */
  protected readonly targetName: Signal<string> = computed((): string =>
    nameFromUrl(this.cloneUrl()),
  );

  /**
   * Gets whether everything a clone needs is in place.
   */
  protected readonly cloneReady: Signal<boolean> = computed(
    (): boolean =>
      this.canClone() &&
      this.layout() !== null &&
      this.urlValid() &&
      FOLDER_NAME.test(this.targetName()) &&
      !this.cloning(),
  );

  /**
   * Gets the browse views the repositories' data supports: a view that reads a fact no repository
   * carries is not offered, rather than shown empty.
   */
  protected readonly browse: Signal<readonly BrowseEntry[]> = computed(
    (): readonly BrowseEntry[] => {
      const repositories: readonly HostedRepository[] = this.repositories();
      const carried: (field: 'starred' | 'fork' | 'archived') => boolean = (
        field: 'starred' | 'fork' | 'archived',
      ): boolean =>
        repositories.some((repository: HostedRepository): boolean => field in repository);
      return this.allViews.filter((entry: BrowseEntry): boolean => {
        switch (entry.view) {
          case 'starred':
            return carried('starred') || this.starredElsewhere().length > 0;
          case 'forks':
            return carried('fork');
          case 'archived':
            return carried('archived');
          default:
            return true;
        }
      });
    },
  );

  /**
   * Gets the hosts the accounts are on, for the host filter.
   */
  protected readonly hosts: Signal<readonly string[]> = computed((): readonly string[] => [
    ...new Set<string>(this.accounts().map((account: HostedAccount): string => account.host)),
  ]);

  /**
   * Gets the repository filter's choices: the browse views the data supports, then — when there is
   * more than one host to tell apart — the hosts. One choice applies at a time.
   */
  protected readonly filterOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      ...this.browse().map((entry: BrowseEntry): DropdownOption => ({
        value: `view:${entry.view}`,
        label: `${entry.label} (${this.countIn(entry.view)})`,
      })),
      ...(this.hosts().length > 1
        ? this.hosts().map((name: string): DropdownOption => ({
            value: `host:${name}`,
            label: `${name} (${this.countOn(name)})`,
            group: 'Hosts',
          }))
        : []),
    ],
  );

  /**
   * Gets the repository filter's current choice.
   */
  protected readonly filterValue: Signal<string> = computed((): string => {
    const host: string | null = this.host();
    return host === null ? `view:${this.view()}` : `host:${host}`;
  });

  /**
   * Gets the repositories in the current view, host and search, most recently updated first.
   */
  protected readonly visible: Signal<readonly HostedRepository[]> = computed(
    (): readonly HostedRepository[] => {
      const host: string | null = this.host();
      const needle: string = this.query().trim().toLowerCase();
      const hostOf: ReadonlyMap<string, string> = new Map<string, string>(
        this.accounts().map((account: HostedAccount): [string, string] => [
          account.id,
          account.host,
        ]),
      );
      return this.inViewList(this.view())
        .filter(
          (repository: HostedRepository): boolean =>
            host === null || hostOf.get(repository.accountId) === host,
        )
        .filter(
          (repository: HostedRepository): boolean =>
            needle.length === 0 ||
            repository.fullName.toLowerCase().includes(needle) ||
            repository.description.toLowerCase().includes(needle),
        )
        .sort((a: HostedRepository, b: HostedRepository): number => b.updatedAt - a.updatedAt);
    },
  );

  /**
   * Gets the repository shown in the detail panel, or null.
   */
  protected readonly selected: Signal<HostedRepository | null> = computed(
    (): HostedRepository | null =>
      [...this.repositories(), ...this.starredElsewhere()].find(
        (repository: HostedRepository): boolean => repository.id === this.selectedId(),
      ) ?? null,
  );

  /**
   * Reads the repositories when the section is first built.
   */
  public ngOnInit(): void {
    void this.refresh();
  }

  /**
   * Reads the accounts every signed-in host lists, and each account's repositories. A host that is not
   * signed in is listed apart, with a way to sign in; one account failing does not hide the rest.
   * @returns Resolves once everything has been read.
   */
  public async refresh(): Promise<void> {
    if (!this.forge.isAvailable) {
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const hosts: readonly ForgeHostAccount[] = await this.forge.hosts();
      const accounts: HostedAccount[] = [];
      const repositories: HostedRepository[] = [];
      const errors: string[] = [];
      this.signedOut.set(
        hosts
          .filter((entry: ForgeHostAccount): boolean => !entry.status.authenticated)
          .map((entry: ForgeHostAccount): SignedOutHost => ({
            host: entry.host,
            provider: entry.provider,
          })),
      );
      const starred: HostedRepository[] = [];
      for (const entry of hosts.filter((h: ForgeHostAccount): boolean => h.status.authenticated)) {
        const listed: ForgeResult<readonly ProtocolAccount[]> = await this.forge.accounts(
          entry.host,
        );
        if (!listed.ok) {
          errors.push(`${entry.provider}: ${listed.error}`);
          continue;
        }
        // Starred repositories are filed under the user's own account on the host, so the host filter
        // finds them; a host whose plugin cannot list them simply has none.
        const user: ProtocolAccount | undefined =
          listed.value.find((account: ProtocolAccount): boolean => account.kind === 'user') ??
          listed.value[0];
        if (user !== undefined) {
          const stars: ForgeResult<readonly ProtocolRepository[]> =
            await this.forge.starredRepositories(entry.host);
          if (stars.ok) {
            starred.push(
              ...stars.value.map((repository: ProtocolRepository): HostedRepository =>
                toView(repository, `${entry.host}/${user.login}`),
              ),
            );
          }
        }
        for (const account of listed.value) {
          const view: HostedAccount = {
            id: `${entry.host}/${account.login}`,
            host: entry.provider,
            login: account.login,
          };
          accounts.push(view);
          const repos: ForgeResult<readonly ProtocolRepository[]> = await this.forge.repositories(
            entry.host,
            account.login,
          );
          if (!repos.ok) {
            errors.push(`${account.login}: ${repos.error}`);
            continue;
          }
          for (const repository of repos.value) {
            repositories.push(toView(repository, view.id));
          }
        }
      }
      this.accounts.set(accounts);
      const own: readonly HostedRepository[] = dedupe(repositories);
      const ids: ReadonlySet<string> = new Set<string>(
        own.map((repository: HostedRepository): string => repository.id),
      );
      this.repositories.set(own);
      this.starredElsewhere.set(
        dedupe(starred).filter((repository: HostedRepository): boolean => !ids.has(repository.id)),
      );
      this.loadError.set(errors.length === 0 ? null : errors.join(' · '));
      this.log.info(
        'welcome',
        `Listed ${repositories.length} repositories across ${accounts.length} accounts`,
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Applies the repository filter's choice: a browse view across every host, or every repository on
   * one host.
   * @param value The picked value.
   */
  protected setFilter(value: string): void {
    if (value.startsWith('host:')) {
      this.view.set('all');
      this.host.set(value.slice('host:'.length));
      return;
    }
    const view: BrowseView | undefined = this.allViews.find(
      (entry: BrowseEntry): boolean => `view:${entry.view}` === value,
    )?.view;
    if (view !== undefined) {
      this.host.set(null);
      this.view.set(view);
    }
  }

  /**
   * Counts the repositories in a browse view.
   * @param view The view.
   * @returns Returns the count.
   */
  protected countIn(view: BrowseView): number {
    return this.inViewList(view).length;
  }

  /**
   * Counts the repositories on a host.
   * @param host The host.
   * @returns Returns the count.
   */
  protected countOn(host: string): number {
    const accounts: ReadonlySet<string> = new Set<string>(
      this.accounts()
        .filter((account: HostedAccount): boolean => account.host === host)
        .map((account: HostedAccount): string => account.id),
    );
    return this.repositories().filter((repository: HostedRepository): boolean =>
      accounts.has(repository.accountId),
    ).length;
  }

  /**
   * Updates the clone URL from the input event.
   * @param event The input event carrying the current value.
   */
  protected onUrlInput(event: Event): void {
    this.cloneUrl.set((event.target as HTMLInputElement).value);
    this.cloneError.set(null);
  }

  /**
   * Opens a sidebar section, collapsing the others; clicking the open section collapses it.
   * @param section The section whose header was clicked.
   */
  protected toggleSection(section: SourceSection): void {
    this.openSection.update((open: SourceSection | null): SourceSection | null =>
      open === section ? null : section,
    );
  }

  /**
   * Records the layout picked.
   * @param value The picked value.
   */
  protected setLayout(value: string): void {
    this.layout.set(value === 'worktree' || value === 'flat' ? value : null);
  }

  /**
   * Updates the repository search from the input event.
   * @param event The input event carrying the current value.
   */
  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Asks the user where clones go, in the main process's own folder dialog.
   * @returns Resolves with the chosen folder, or null when the dialog was cancelled.
   */
  protected async chooseParent(): Promise<string | null> {
    return this.cloner.pickParent();
  }

  /**
   * Asks where the clone goes — the folder dialog opens on the folder used last — then clones the URL
   * in the field into it, opens the result and steps aside. Cancelling the dialog clones nothing.
   * @returns Resolves once the clone has settled, however it settled.
   */
  protected async clone(): Promise<void> {
    const layout: CloneLayout | null = this.layout();
    if (!this.cloneReady() || layout === null || (await this.chooseParent()) === null) {
      return;
    }
    this.cloning.set(true);
    this.cloneError.set(null);
    try {
      const outcome: CloneOutcome = await this.cloner.clone({
        url: this.cloneUrl().trim(),
        name: this.targetName(),
        layout,
      });
      if (!outcome.ok) {
        this.cloneError.set(outcome.error);
        return;
      }
      if (await this.fileOpener.reopenDirectory(outcome.path)) {
        this.opened.emit();
      } else {
        this.cloneError.set(`Cloned into ${outcome.path}, but it could not be opened.`);
      }
    } finally {
      this.cloning.set(false);
    }
  }

  /**
   * Puts a repository's clone URL in the field, ready to clone.
   * @param repository The repository.
   */
  protected prepareClone(repository: HostedRepository): void {
    this.cloneUrl.set(repository.cloneUrl);
    this.cloneError.set(null);
  }

  /**
   * Opens the Plugin Manager, where version-control and hosting plugins are installed.
   */
  protected openPlugins(): void {
    this.openTab.emit('plugin-manager');
  }

  /**
   * Opens Settings, where a host is signed in to.
   */
  protected openSettings(): void {
    this.openTab.emit('settings');
  }

  /**
   * Formats how long ago a repository was updated.
   * @param at The epoch-millisecond timestamp.
   * @returns Returns a short relative label.
   */
  protected updated(at: number): string {
    const days: number = Math.floor(Math.max(0, Date.now() - at) / (24 * 60 * 60 * 1000));
    if (days === 0) {
      return 'Updated today';
    }
    if (days === 1) {
      return 'Updated yesterday';
    }
    if (days < 7) {
      return `Updated ${days}d ago`;
    }
    if (days < 30) {
      return `Updated ${Math.floor(days / 7)}w ago`;
    }
    return `Updated ${Math.floor(days / 30)}mo ago`;
  }

  /**
   * Gets the repositories a browse view lists: the user's own that match it, and — for Starred — the
   * other people's projects they starred as well.
   * @param view The view.
   * @returns Returns them, unsorted.
   */
  private inViewList(view: BrowseView): readonly HostedRepository[] {
    const own: readonly HostedRepository[] = this.repositories().filter(
      (repository: HostedRepository): boolean => this.matchesView(repository, view),
    );
    return view === 'starred' ? [...own, ...this.starredElsewhere()] : own;
  }

  /**
   * Determines whether a repository belongs in a browse view.
   * @param repository The repository.
   * @param view The view.
   * @returns Returns true when it does.
   */
  private matchesView(repository: HostedRepository, view: BrowseView): boolean {
    switch (view) {
      case 'all':
        return true;
      case 'starred':
        return repository.starred === true;
      case 'recent':
        return Date.now() - repository.updatedAt < RECENT_MS;
      case 'private':
        return repository.private;
      case 'forks':
        return repository.fork === true;
      case 'archived':
        return repository.archived === true;
    }
  }
}

/**
 * Takes the folder name a clone URL suggests: its last path segment, without `.git`.
 * @param url The URL.
 * @returns Returns the name, or empty.
 */
export function nameFromUrl(url: string): string {
  const last: string =
    url
      .trim()
      .replace(/[/\\]+$/, '')
      .split(/[/:]/)
      .pop() ?? '';
  return last.replace(/\.git$/i, '');
}

/**
 * Turns a repository as the hosting protocol describes it into the browser's view of it, carrying the
 * optional facts only when the plugin supplied them.
 * @param repository The protocol's repository.
 * @param accountId The account it was listed through.
 * @returns Returns the view.
 */
function toView(repository: ProtocolRepository, accountId: string): HostedRepository {
  const extra: Record<string, unknown> = repository as unknown as Record<string, unknown>;
  const optional: Partial<HostedRepository> = {};
  for (const key of ['language', 'stars', 'fork', 'archived', 'starred'] as const) {
    if (extra[key] !== undefined) {
      (optional as Record<string, unknown>)[key] = extra[key];
    }
  }
  const updated: number = Date.parse(repository.updatedAt);
  return {
    id: `${repository.ref.host}/${repository.ref.owner}/${repository.ref.name}`,
    accountId,
    name: repository.ref.name,
    fullName: `${repository.ref.owner}/${repository.ref.name}`,
    description: repository.description ?? '',
    updatedAt: Number.isFinite(updated) ? updated : 0,
    private: repository.private,
    cloneUrl: repository.cloneUrl,
    ...(repository.defaultBranch === null ? {} : { defaultBranch: repository.defaultBranch }),
    ...optional,
  };
}

/**
 * Keeps one entry per repository: an organisation's repository can also be listed through the user.
 * @param repositories The repositories, in listing order.
 * @returns Returns them, first listing kept.
 */
function dedupe(repositories: readonly HostedRepository[]): readonly HostedRepository[] {
  const seen: Set<string> = new Set<string>();
  return repositories.filter((repository: HostedRepository): boolean => {
    if (seen.has(repository.id)) {
      return false;
    }
    seen.add(repository.id);
    return true;
  });
}
