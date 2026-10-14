import { computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type { HostedAccount } from '@shared/api/hosting-protocol';
import type { NewProjectRepository } from '@shared/api/new-project-channels';
import { installedContributions } from '@shared/api/plugin-channels';
import type { VersionControlPluginInfo } from '@shared/api/source-control-channels';
import type { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Clone } from '@shared/angular/services/clone/clone';
import { Forge } from '@shared/angular/services/forge/forge';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { SourceControl } from '@shared/angular/services/source-control/source-control';

/**
 * Where a new project's repository lives: nowhere, on this machine only, or on a code host as well.
 */
export type ProjectRepository = 'none' | 'local' | 'public' | 'private';

/**
 * How a new project's repository is laid out on disk: as a plain checkout, or as a worktree container.
 */
export type ProjectLayout = 'flat' | 'worktree';

/**
 * Describes an account a hosted repository can be made under.
 */
export interface ProjectAccount {
  /**
   * Gets the account's key: its host and login.
   */
  readonly id: string;

  /**
   * Gets the code host, e.g. "github.com".
   */
  readonly host: string;

  /**
   * Gets the host's display name, e.g. "GitHub".
   */
  readonly provider: string;

  /**
   * Gets the account's login.
   */
  readonly login: string;
}

/**
 * Matches a name that can be a folder's: letters, digits, dots, hyphens and underscores, but not "."
 * or "..". The same rule as a clone's folder.
 */
const FOLDER_NAME: RegExp = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * The layout choices, the same as cloning's.
 */
export const PROJECT_LAYOUT_OPTIONS: readonly DropdownOption[] = [
  { value: 'flat', label: 'Flat Repository' },
  { value: 'worktree', label: 'Worktree Repository' },
];

/**
 * Holds where a new project goes and what it starts with — its name, the folder it is made in, and its
 * repository — and what the machine can offer for each (#876). Shared by the New Project wizard and
 * the card an agent tab offers a workspace with, so both ask the same questions the same way.
 *
 * A plain class rather than a service: each asker holds its own, made where `inject` works (a field
 * of a component or a service), so the wizard's draft and an agent's card never share answers.
 */
export class ProjectDestination {
  /**
   * Holds the folder-picking and clone-parent client.
   */
  private readonly cloner: Clone = inject(Clone);

  /**
   * Holds the plugin client, which says what is installed.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the forge client, which lists the accounts a repository can be made under.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds the source-control client, which says whether a repository can be made in place.
   */
  private readonly sourceControl: SourceControl = inject(SourceControl);

  /**
   * Holds whether what the machine can offer has been read.
   */
  private initialised: boolean = false;

  /**
   * Holds the project's name, which is its folder's.
   */
  public readonly name: WritableSignal<string> = signal<string>('');

  /**
   * Holds the folder the project is made in, or null until it is known.
   */
  public readonly location: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the repository picked, or null before one is.
   */
  public readonly repository: WritableSignal<ProjectRepository | null> =
    signal<ProjectRepository | null>(null);

  /**
   * Holds the repository's layout, or null before one is picked.
   */
  public readonly layout: WritableSignal<ProjectLayout | null> = signal<ProjectLayout | null>(null);

  /**
   * Holds the account a hosted repository is made under, or null before one is picked.
   */
  public readonly account: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the accounts hosted repositories can be made under, across the signed-in hosts.
   */
  public readonly accounts: WritableSignal<readonly ProjectAccount[]> = signal<
    readonly ProjectAccount[]
  >([]);

  /**
   * Holds whether a running version-control plugin can make a repository in place — as it says, not
   * the catalogue, whose entry may be newer than the copy installed.
   */
  public readonly canInit: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether a version-control plugin is installed.
   */
  public readonly canVersion: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'version-control').length > 0,
  );

  /**
   * Gets whether a hosting plugin is installed.
   */
  public readonly canHost: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'hosting').length > 0,
  );

  /**
   * Gets whether the repository picked is one a code host makes.
   */
  public readonly hosted: Signal<boolean> = computed(
    (): boolean => this.repository() === 'public' || this.repository() === 'private',
  );

  /**
   * Gets whether the name can be a folder's.
   */
  public readonly nameValid: Signal<boolean> = computed((): boolean =>
    FOLDER_NAME.test(this.name().trim()),
  );

  /**
   * Gets where the project's folder would be made, or null until the name and place are known.
   */
  public readonly target: Signal<string | null> = computed((): string | null => {
    const location: string | null = this.location();
    return location === null || !this.nameValid()
      ? null
      : `${location.replace(/[\\/]+$/, '')}/${this.name().trim()}`;
  });

  /**
   * Gets what is wrong with the answers so far, or null when nothing is: a name that cannot be a
   * folder's, a repository without its layout, a hosted one without its account.
   */
  public readonly problem: Signal<string | null> = computed((): string | null => {
    if (!this.nameValid()) {
      return 'The name can use letters, digits, dots, hyphens and underscores only.';
    }
    const repository: ProjectRepository | null = this.repository();
    if (repository !== null && repository !== 'none' && this.layout() === null) {
      return 'Choose how the repository is laid out.';
    }
    if (this.hosted() && this.account() === null) {
      return 'Choose the account the repository is made under.';
    }
    return null;
  });

  /**
   * Gets the repository choices the installed plugins can make: none always; a local one with a
   * version-control plugin that can make one; a hosted one — made by the code host, then cloned — with
   * a hosting plugin as well.
   */
  public readonly repositoryOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: 'none', label: 'No Repository' },
      ...(this.canVersion() && this.canInit()
        ? [{ value: 'local', label: 'Local Repository' }]
        : []),
      ...(this.canVersion() && this.canHost()
        ? [
            { value: 'public', label: 'Public Repository' },
            { value: 'private', label: 'Private Repository' },
          ]
        : []),
    ],
  );

  /**
   * Gets the account choices.
   */
  public readonly accountOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.accounts().map((account: ProjectAccount): DropdownOption => ({
        value: account.id,
        label: `${account.login} (${account.provider})`,
      })),
  );

  /**
   * Starts reading what the machine can do: where projects go, the accounts, and whether a repository
   * can be made in place. Read once; the destination keeps it after.
   */
  public initialise(): void {
    if (this.initialised) {
      return;
    }
    this.initialised = true;
    void this.cloner.parent().then((parent: string | null): void => {
      if (this.location() === null) {
        this.location.set(parent);
      }
    });
    void this.loadAccounts();
    void this.loadCanInit();
  }

  /**
   * Records the repository picked, picking the sole account when a hosted one has only one.
   * @param repository The repository.
   */
  public setRepository(repository: ProjectRepository | null): void {
    this.repository.set(repository);
    if (this.hosted() && this.account() === null && this.accounts().length === 1) {
      this.account.set(this.accounts()[0].id);
    }
  }

  /**
   * Asks where the project goes, in the main process's folder dialog.
   * @returns Resolves once the dialog has closed.
   */
  public async browse(): Promise<void> {
    const chosen: string | null = await this.cloner.pickParent();
    if (chosen !== null) {
      this.location.set(chosen);
    }
  }

  /**
   * Clears the answers, keeping what the machine can do and where projects go.
   */
  public reset(): void {
    this.name.set('');
    this.repository.set(null);
    this.layout.set(null);
    this.account.set(null);
  }

  /**
   * Builds the repository the project is made with.
   * @returns Returns the repository, or null while it is not yet fully described.
   */
  public repositoryRequest(): NewProjectRepository | null {
    const choice: ProjectRepository | null = this.repository();
    const layout: ProjectLayout | null = this.layout();
    if (choice === null || choice === 'none') {
      return { kind: 'none' };
    }
    if (layout === null) {
      return null;
    }
    if (choice === 'local') {
      return { kind: 'local', layout };
    }
    const account: ProjectAccount | undefined = this.accounts().find(
      (candidate: ProjectAccount): boolean => candidate.id === this.account(),
    );
    return account === undefined
      ? null
      : {
          kind: 'hosted',
          host: account.host,
          account: account.login,
          private: choice === 'private',
          layout,
        };
  }

  /**
   * Asks the running version-control plugins whether any can make a repository in place.
   * @returns Resolves once they have answered.
   */
  private async loadCanInit(): Promise<void> {
    const plugins: readonly VersionControlPluginInfo[] =
      (await this.sourceControl.client?.listPlugins()) ?? [];
    this.canInit.set(
      plugins.some(
        (plugin: VersionControlPluginInfo): boolean =>
          plugin.installed && plugin.capabilities.includes('init'),
      ),
    );
  }

  /**
   * Reads the accounts on every signed-in host. A host that fails is left out rather than failing the
   * rest; with no hosting plugin there are none.
   * @returns Resolves once they have been read.
   */
  private async loadAccounts(): Promise<void> {
    if (!this.forge.isAvailable || !this.canHost()) {
      return;
    }
    const accounts: ProjectAccount[] = [];
    const hosts: readonly ForgeHostAccount[] = await this.forge.hosts();
    for (const entry of hosts.filter((h: ForgeHostAccount): boolean => h.status.authenticated)) {
      const listed: ForgeResult<readonly HostedAccount[]> = await this.forge.accounts(entry.host);
      if (listed.ok) {
        accounts.push(
          ...listed.value.map((account: HostedAccount): ProjectAccount => ({
            id: `${entry.host}/${account.login}`,
            host: entry.host,
            provider: entry.provider,
            login: account.login,
          })),
        );
      }
    }
    this.accounts.set(accounts);
    if (this.hosted() && this.account() === null && accounts.length === 1) {
      this.account.set(accounts[0].id);
    }
  }
}

/**
 * Words a project's repository for the first message.
 * @param repository The repository made.
 * @returns Returns the phrase, or null for none.
 */
export function describeRepository(repository: NewProjectRepository): string | null {
  switch (repository.kind) {
    case 'none':
      return null;
    case 'local':
      return 'a local repository';
    case 'hosted':
      return `a ${repository.private ? 'private' : 'public'} repository on ${repository.host}`;
  }
}
