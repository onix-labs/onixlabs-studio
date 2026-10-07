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
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

export type { CloneLayout } from '@shared/api/clone-channels';

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
 * Describes a browse view on the left.
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

  /**
   * Gets its icon.
   */
  readonly icon: Icon;
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
  imports: [AppIcon, TooltipTrigger],
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
    { view: 'all', label: 'All Repositories', icon: Icon.WELCOME_REPOSITORIES },
    { view: 'starred', label: 'Starred', icon: Icon.WELCOME_STARRED },
    { view: 'recent', label: 'Recent', icon: Icon.WELCOME_RECENT },
    { view: 'private', label: 'Private', icon: Icon.WELCOME_REPOSITORY_PRIVATE },
    { view: 'forks', label: 'Forks', icon: Icon.WELCOME_FORKS },
    { view: 'archived', label: 'Archived', icon: Icon.WELCOME_ARCHIVED },
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
   * Holds the folder name the clone is given, or null to take it from the URL.
   */
  protected readonly folderName: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the branch to check out, or empty for the repository's default.
   */
  protected readonly branch: WritableSignal<string> = signal<string>('');

  /**
   * Holds the folder clones go into, or null until one is chosen.
   */
  protected readonly parent: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds how the repository will be laid out once cloned. Studio has no default of its own: it is
   * the user's choice, made before cloning, so the field starts on the flat working copy everyone
   * already knows and remembers nothing.
   */
  protected readonly layout: WritableSignal<CloneLayout> = signal<CloneLayout>('flat');

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
   * Gets the folder name the clone will be given: the one typed, or the URL's last part.
   */
  protected readonly targetName: Signal<string> = computed(
    (): string => this.folderName() ?? nameFromUrl(this.cloneUrl()),
  );

  /**
   * Gets whether everything a clone needs is in place.
   */
  protected readonly cloneReady: Signal<boolean> = computed(
    (): boolean =>
      this.canClone() && this.urlValid() && FOLDER_NAME.test(this.targetName()) && !this.cloning(),
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
            return carried('starred');
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
   * Gets the hosts the accounts are on, for the host filter pills.
   */
  protected readonly hosts: Signal<readonly string[]> = computed((): readonly string[] => [
    ...new Set<string>(this.accounts().map((account: HostedAccount): string => account.host)),
  ]);

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
      return this.repositories()
        .filter((repository: HostedRepository): boolean => this.inView(repository))
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
      this.repositories().find(
        (repository: HostedRepository): boolean => repository.id === this.selectedId(),
      ) ?? null,
  );

  /**
   * Reads the clone folder and the repositories when the section is first built.
   */
  public ngOnInit(): void {
    void this.cloner.parent().then((parent: string | null): void => this.parent.set(parent));
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
      for (const entry of hosts.filter((h: ForgeHostAccount): boolean => h.status.authenticated)) {
        const listed: ForgeResult<readonly ProtocolAccount[]> = await this.forge.accounts(
          entry.host,
        );
        if (!listed.ok) {
          errors.push(`${entry.provider}: ${listed.error}`);
          continue;
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
      this.repositories.set(dedupe(repositories));
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
   * Counts the repositories in a browse view.
   * @param view The view.
   * @returns Returns the count.
   */
  protected countIn(view: BrowseView): number {
    return this.repositories().filter((repository: HostedRepository): boolean =>
      this.matchesView(repository, view),
    ).length;
  }

  /**
   * Counts the repositories on a host.
   * @param host The host, or null for every host.
   * @returns Returns the count.
   */
  protected countOn(host: string | null): number {
    if (host === null) {
      return this.repositories().length;
    }
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
   * Updates the folder name from the input event; clearing it goes back to the URL's name.
   * @param event The input event carrying the current value.
   */
  protected onNameInput(event: Event): void {
    const value: string = (event.target as HTMLInputElement).value.trim();
    this.folderName.set(value.length === 0 ? null : value);
    this.cloneError.set(null);
  }

  /**
   * Updates the branch from the input event.
   * @param event The input event carrying the current value.
   */
  protected onBranchInput(event: Event): void {
    this.branch.set((event.target as HTMLInputElement).value.trim());
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
    const chosen: string | null = await this.cloner.pickParent();
    if (chosen !== null) {
      this.parent.set(chosen);
    }
    return chosen;
  }

  /**
   * Clones the URL in the field into the chosen folder, asking for the folder first when none is
   * chosen, then opens the result and steps aside.
   * @returns Resolves once the clone has settled, however it settled.
   */
  protected async clone(): Promise<void> {
    if (!this.cloneReady()) {
      return;
    }
    if (this.parent() === null && (await this.chooseParent()) === null) {
      return;
    }
    this.cloning.set(true);
    this.cloneError.set(null);
    try {
      const branch: string = this.branch();
      const outcome: CloneOutcome = await this.cloner.clone({
        url: this.cloneUrl().trim(),
        name: this.targetName(),
        layout: this.layout(),
        ...(branch.length === 0 ? {} : { branch }),
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
    this.folderName.set(null);
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
   * Determines whether a repository belongs in the current browse view.
   * @param repository The repository.
   * @returns Returns true when it does.
   */
  private inView(repository: HostedRepository): boolean {
    return this.matchesView(repository, this.view());
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
