import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * An account on a code host — GitHub, GitLab, Bitbucket, Azure DevOps — that a hosting plugin has
 * connected.
 */
export interface HostedAccount {
  /**
   * Gets the account's id, unique across hosts.
   */
  readonly id: string;

  /**
   * Gets the host's name, e.g. "GitHub".
   */
  readonly host: string;

  /**
   * Gets the account's user or organisation name.
   */
  readonly login: string;
}

/**
 * A repository an account can reach.
 */
export interface HostedRepository {
  /**
   * Gets the repository's id, unique across hosts.
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
   * Gets its main language, or null.
   */
  readonly language: string | null;

  /**
   * Gets its star count.
   */
  readonly stars: number;

  /**
   * Gets when it was last updated (epoch ms).
   */
  readonly updatedAt: number;

  /**
   * Gets a value indicating whether it is private.
   */
  readonly private: boolean;

  /**
   * Gets a value indicating whether it is a fork.
   */
  readonly fork: boolean;

  /**
   * Gets a value indicating whether it is archived.
   */
  readonly archived: boolean;

  /**
   * Gets a value indicating whether the user starred it.
   */
  readonly starred: boolean;

  /**
   * Gets the URL it clones from.
   */
  readonly cloneUrl: string;
}

/**
 * How a repository is laid out on disk once cloned: a plain working copy, or a worktree container
 * ready for several branches to be worked at once.
 */
export type CloneLayout = 'flat' | 'worktree';

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
 * The welcome screen's Source Control section: "I want to find or bring existing code into Studio".
 * Clone a repository by its URL — choosing, before it is cloned, whether it lands as a flat working
 * copy or as a worktree container — or browse the repositories of the accounts connected through
 * hosting plugins.
 *
 * ⚠️ Nothing feeds it yet. Cloning and listing repositories arrive with the version-control and
 * hosting plugins (core is UI only), so for now it shows its empty states and says why. The list,
 * filters and detail panel are built against {@link HostedAccount} and {@link HostedRepository} so the
 * plugins only have to supply them.
 */
@Component({
  selector: 'app-welcome-source-control',
  imports: [AppIcon, TooltipTrigger],
  templateUrl: './welcome-source-control.html',
  styleUrl: './welcome-source-control.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeSourceControl {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Emits the kind of tab an action asks for; the welcome screen opens it and steps aside.
   */
  public readonly openTab: OutputEmitterRef<TabType> = output<TabType>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the browse views.
   */
  protected readonly browse: readonly BrowseEntry[] = [
    { view: 'all', label: 'All Repositories', icon: Icon.WELCOME_REPOSITORIES },
    { view: 'starred', label: 'Starred', icon: Icon.WELCOME_STARRED },
    { view: 'recent', label: 'Recent', icon: Icon.WELCOME_RECENT },
    { view: 'private', label: 'Private', icon: Icon.WELCOME_REPOSITORY_PRIVATE },
    { view: 'forks', label: 'Forks', icon: Icon.WELCOME_FORKS },
    { view: 'archived', label: 'Archived', icon: Icon.WELCOME_ARCHIVED },
  ];

  /**
   * Holds the connected accounts. Supplied by hosting plugins; none exist yet.
   */
  protected readonly accounts: WritableSignal<readonly HostedAccount[]> = signal<
    readonly HostedAccount[]
  >([]);

  /**
   * Holds the repositories the connected accounts can reach. Supplied by hosting plugins; none exist
   * yet.
   */
  protected readonly repositories: WritableSignal<readonly HostedRepository[]> = signal<
    readonly HostedRepository[]
  >([]);

  /**
   * Holds the URL typed into the clone field.
   */
  protected readonly cloneUrl: WritableSignal<string> = signal<string>('');

  /**
   * Holds how the repository will be laid out once cloned. Studio has no default of its own: it is
   * the user's choice, made before cloning, so the field starts on the flat working copy everyone
   * already knows and remembers nothing.
   */
  protected readonly layout: WritableSignal<CloneLayout> = signal<CloneLayout>('flat');

  /**
   * Holds a value indicating whether a clone was asked for, so the screen can say why it cannot.
   */
  protected readonly cloneRequested: WritableSignal<boolean> = signal<boolean>(false);

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
   * Gets the hosts the connected accounts are on, for the host filter pills.
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
    this.cloneRequested.set(false);
  }

  /**
   * Updates the repository search from the input event.
   * @param event The input event carrying the current value.
   */
  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Asks to clone the URL in the field. Nothing can clone yet, so the screen says why.
   */
  protected clone(): void {
    if (!this.urlValid()) {
      return;
    }
    this.log.info('welcome', `Clone requested as ${this.layout()} (not available yet)`);
    this.cloneRequested.set(true);
  }

  /**
   * Puts a repository's clone URL in the field, ready to clone.
   * @param repository The repository.
   */
  protected prepareClone(repository: HostedRepository): void {
    this.cloneUrl.set(repository.cloneUrl);
    this.cloneRequested.set(false);
  }

  /**
   * Opens the Plugin Manager, where version-control and hosting plugins will be installed.
   */
  protected openPlugins(): void {
    this.openTab.emit('plugin-manager');
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
        return repository.starred;
      case 'recent':
        return Date.now() - repository.updatedAt < RECENT_MS;
      case 'private':
        return repository.private;
      case 'forks':
        return repository.fork;
      case 'archived':
        return repository.archived;
    }
  }
}
