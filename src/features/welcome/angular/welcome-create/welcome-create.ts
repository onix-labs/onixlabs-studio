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
import type { ForgeHostAccount, ForgeResult } from '@shared/api/forge-types';
import type { HostedAccount } from '@shared/api/hosting-protocol';
import type { NewProjectOutcome, NewProjectRepository } from '@shared/api/new-project-channels';
import { installedContributions } from '@shared/api/plugin-channels';
import type { Skill } from '@shared/api/skill-channels';
import { Clone } from '@shared/angular/services/clone/clone';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Forge } from '@shared/angular/services/forge/forge';
import { NewProject } from '@shared/angular/services/new-project/new-project';
import { Skills } from '@shared/angular/services/skills/skills';
import type { WorkspaceAgentStart } from '@shared/angular/services/workspaces/workspaces';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { OverlayScrollbar } from '@shared/angular/components/overlay-scrollbar/overlay-scrollbar';

/**
 * Where a new project's repository lives: nowhere, on this machine only, or on a code host as well.
 */
export type ProjectRepository = 'none' | 'local' | 'public' | 'private';

/**
 * How a new project's repository is laid out on disk: as a plain checkout, or as a worktree container.
 */
export type ProjectLayout = 'flat' | 'worktree';

/**
 * Describes a project starter: a skill that gives the agent its first idea of what is being built. A
 * starter shapes the questions the agent asks, never the answers — it is not a template.
 */
export interface ProjectStarter {
  /**
   * Gets the name of the skill the starter applies.
   */
  readonly skill: string;

  /**
   * Gets the starter's name.
   */
  readonly title: string;

  /**
   * Gets a line describing it.
   */
  readonly summary: string;

  /**
   * Gets its icon.
   */
  readonly icon: Icon;
}

/**
 * Describes an account a hosted repository can be made under.
 */
interface ProjectAccount {
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
 * The welcome screen's Create Something section: an optional form — a project's name, where it goes
 * and its repository — and the starters that open a project agent. It hosts no conversation itself.
 *
 * Filled in, the form decides that a workspace is made first and the agent opens inside it; left
 * empty, the agent opens in its own tab and asks for those details when the project needs a home. The
 * starter chosen decides only which skill the agent begins with, from the most general ("Create
 * Something") to the specific.
 *
 * A complete form makes the project — the folder, or a clone of a repository the code host makes — and
 * opens it with the agent waiting, briefed on the project and its starter's skill when the library has
 * it.
 *
 * ⚠️ Still to come: the starters are a fixed list rather than the skill library's, a local repository
 * needs the version-control plugin to learn to make one, and an empty form only says what it would do.
 */
@Component({
  selector: 'app-welcome-create',
  imports: [AppIcon, Dropdown, OverlayScrollbar],
  templateUrl: './welcome-create.html',
  styleUrl: './welcome-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeCreate implements OnInit {
  /**
   * Emits once a project has been made and opened, so the welcome screen steps aside.
   */
  public readonly opened: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the clone service, whose remembered parent folder is where new projects go too.
   */
  private readonly cloner: Clone = inject(Clone);

  /**
   * Holds the plugin registry, which says whether repositories can be made and hosted.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the forge service, which lists the accounts a repository can be made under.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds the new-project service, which makes the project in the main process.
   */
  private readonly newProject: NewProject = inject(NewProject);

  /**
   * Holds the file opener, which opens the project as a workspace.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the skill library, where a starter's skill is looked up.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Gets the starter every project can begin with: no assumption about what is being built.
   */
  protected readonly general: ProjectStarter = {
    skill: 'new-project',
    title: 'New Project Agent',
    summary: 'Tell the agent about your project and plan it together.',
    icon: Icon.WELCOME_PROJECT_AGENT,
  };

  /**
   * Gets the starters, from the general to the specific.
   */
  protected readonly starters: readonly ProjectStarter[] = [
    {
      skill: 'new-project',
      title: 'Create Something',
      summary: 'No idea of the shape yet: talk it through from the beginning.',
      icon: Icon.WELCOME_STARTER_ANYTHING,
    },
    {
      skill: 'new-desktop-app',
      title: 'Desktop Application',
      summary: 'A native or cross-platform app for Windows, macOS and Linux.',
      icon: Icon.WELCOME_STARTER_DESKTOP,
    },
    {
      skill: 'new-web-app',
      title: 'Web Application',
      summary: 'A site or app in the browser, with or without a back end.',
      icon: Icon.WELCOME_STARTER_WEB,
    },
    {
      skill: 'new-mobile-app',
      title: 'Mobile Application',
      summary: 'An app for iOS, Android, or both.',
      icon: Icon.WELCOME_STARTER_MOBILE,
    },
    {
      skill: 'new-flutter-app',
      title: 'Cross-Platform Mobile App with Flutter',
      summary: 'Dart and Flutter, for iOS and Android from one code base.',
      icon: Icon.WELCOME_STARTER_MOBILE,
    },
    {
      skill: 'new-service',
      title: 'API or Service',
      summary: 'A back-end service, its API, data and deployment.',
      icon: Icon.WELCOME_STARTER_SERVICE,
    },
    {
      skill: 'new-cli-tool',
      title: 'Command-Line Tool',
      summary: 'A tool run from the terminal, and how it is installed.',
      icon: Icon.WELCOME_STARTER_CLI,
    },
    {
      skill: 'new-library',
      title: 'Library or Package',
      summary: 'Reusable code, published for others to depend on.',
      icon: Icon.WELCOME_STARTER_LIBRARY,
    },
    {
      skill: 'new-game',
      title: 'Game',
      summary: 'A game, its engine and the platforms it ships to.',
      icon: Icon.WELCOME_STARTER_GAME,
    },
  ];

  /**
   * Holds the project's name, which is also its folder's.
   */
  protected readonly name: WritableSignal<string> = signal<string>('');

  /**
   * Holds the folder the project's folder is made in, or null until one is known.
   */
  protected readonly location: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds where the repository lives, or null until the user picks. As with cloning, Studio has no
   * default of its own.
   */
  protected readonly repository: WritableSignal<ProjectRepository | null> =
    signal<ProjectRepository | null>(null);

  /**
   * Holds how the repository is laid out, or null until the user picks.
   */
  protected readonly layout: WritableSignal<ProjectLayout | null> = signal<ProjectLayout | null>(
    null,
  );

  /**
   * Holds the accounts hosted repositories can be made under, across the signed-in hosts.
   */
  protected readonly accounts: WritableSignal<readonly ProjectAccount[]> = signal<
    readonly ProjectAccount[]
  >([]);

  /**
   * Holds the account picked for a hosted repository — its id — or null.
   */
  protected readonly account: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds what starting would have done, said in place of doing it where it is not built yet.
   */
  protected readonly preview: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the project is being made.
   */
  protected readonly creating: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds why the project could not be made, or null.
   */
  protected readonly error: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets whether a version-control plugin, which makes the repository, is installed.
   */
  protected readonly canVersion: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'version-control').length > 0,
  );

  /**
   * Gets whether a hosting plugin, which makes the remote, is installed.
   */
  protected readonly canHost: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'hosting').length > 0,
  );

  /**
   * Gets the repository choices the installed plugins can make: none always; a local one with a
   * version-control plugin; a hosted one with a hosting plugin as well.
   */
  protected readonly repositoryOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: 'none', label: 'No Repository' },
      ...(this.canVersion() ? [{ value: 'local', label: 'Local Repository' }] : []),
      ...(this.canVersion() && this.canHost()
        ? [
            { value: 'public', label: 'Public Repository' },
            { value: 'private', label: 'Private Repository' },
          ]
        : []),
    ],
  );

  /**
   * Gets whether the repository picked is one a code host makes.
   */
  protected readonly hosted: Signal<boolean> = computed(
    (): boolean => this.repository() === 'public' || this.repository() === 'private',
  );

  /**
   * Gets the account choices.
   */
  protected readonly accountOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.accounts().map((account: ProjectAccount): DropdownOption => ({
        value: account.id,
        label: `${account.login} (${account.provider})`,
      })),
  );

  /**
   * Gets the layout choices, the same as cloning's.
   */
  protected readonly layoutOptions: readonly DropdownOption[] = [
    { value: 'flat', label: 'Flat Repository' },
    { value: 'worktree', label: 'Worktree Repository' },
  ];

  /**
   * Gets whether the name can be a folder's.
   */
  protected readonly nameValid: Signal<boolean> = computed((): boolean =>
    FOLDER_NAME.test(this.name().trim()),
  );

  /**
   * Gets whether the form has been started: anything typed or picked.
   */
  protected readonly started: Signal<boolean> = computed(
    (): boolean => this.name().trim().length > 0 || this.repository() !== null,
  );

  /**
   * Gets whether the form says everything a workspace needs: a name, a place, a repository, and a
   * layout when there is a repository.
   */
  protected readonly complete: Signal<boolean> = computed(
    (): boolean =>
      this.nameValid() &&
      this.location() !== null &&
      this.repository() !== null &&
      (this.repository() === 'none' || this.layout() !== null) &&
      (!this.hosted() || this.account() !== null),
  );

  /**
   * Gets where the project's folder would be made, or null until the name and place are known.
   */
  protected readonly target: Signal<string | null> = computed((): string | null => {
    const location: string | null = this.location();
    return location === null || !this.nameValid()
      ? null
      : `${location.replace(/[\\/]+$/, '')}/${this.name().trim()}`;
  });

  /**
   * Gets the line under the form saying where starting opens the agent.
   */
  protected readonly destination: Signal<string> = computed((): string => {
    if (this.complete()) {
      return `Opens a new workspace at ${this.target()}, with the agent waiting in it.`;
    }
    if (this.started()) {
      return 'Finish the details to open a workspace, or leave them empty and the agent asks for them later.';
    }
    return 'Optional. Without these, the agent opens in its own tab and asks where the project goes when it is ready.';
  });

  /**
   * Starts with the folder clones go into, the one the user chose last, and reads the accounts a
   * repository can be made under.
   */
  public ngOnInit(): void {
    void this.cloner.parent().then((parent: string | null): void => {
      if (this.location() === null) {
        this.location.set(parent);
      }
    });
    void this.loadAccounts();
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
    this.pickSoleAccount();
  }

  /**
   * Picks the account for a hosted repository when there is only one to pick.
   */
  private pickSoleAccount(): void {
    if (this.hosted() && this.account() === null && this.accounts().length === 1) {
      this.account.set(this.accounts()[0].id);
    }
  }

  /**
   * Updates the name from the input event.
   * @param event The input event carrying the current value.
   */
  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.settle();
  }

  /**
   * Asks where the project goes, in the main process's folder dialog.
   * @returns Resolves once the dialog has closed.
   */
  protected async browse(): Promise<void> {
    const chosen: string | null = await this.cloner.pickParent();
    if (chosen !== null) {
      this.location.set(chosen);
      this.settle();
    }
  }

  /**
   * Records the repository picked.
   * @param value The picked value.
   */
  protected setRepository(value: string): void {
    this.repository.set(isRepository(value) ? value : null);
    this.pickSoleAccount();
    this.settle();
  }

  /**
   * Records the account picked.
   * @param value The picked value.
   */
  protected setAccount(value: string): void {
    this.account.set(
      this.accounts().some((account: ProjectAccount): boolean => account.id === value)
        ? value
        : null,
    );
    this.settle();
  }

  /**
   * Records the layout picked.
   * @param value The picked value.
   */
  protected setLayout(value: string): void {
    this.layout.set(value === 'flat' || value === 'worktree' ? value : null);
    this.settle();
  }

  /**
   * Clears what the last start said, once the form changes.
   */
  private settle(): void {
    this.preview.set(null);
    this.error.set(null);
  }

  /**
   * Starts a project agent with a starter's skill: in a new workspace when the form is complete, in
   * its own tab otherwise.
   * @param starter The starter.
   * @returns Resolves once the project is open, or has failed.
   */
  protected async start(starter: ProjectStarter): Promise<void> {
    if (this.creating()) {
      return;
    }
    this.settle();
    if (!this.complete()) {
      // ⚠️ Not built yet: the agent's own tab, which asks for the details later (#806).
      this.log.info('welcome', `Project agent "${starter.skill}" requested without details`);
      this.preview.set(
        `Not built yet: this will open an agent tab, starting from the “${starter.title}” skill, which asks where the project goes later. Fill in the details to open a workspace now.`,
      );
      return;
    }
    const repository: NewProjectRepository | string = this.repositoryRequest();
    if (typeof repository === 'string') {
      this.error.set(repository);
      return;
    }
    const name: string = this.name().trim();
    this.creating.set(true);
    try {
      const outcome: NewProjectOutcome = await this.newProject.create({ name, repository });
      if (!outcome.ok) {
        this.error.set(outcome.error);
        return;
      }
      const skill: Skill | undefined = this.skills
        .skills()
        .find((candidate: Skill): boolean => candidate.enabled && candidate.name === starter.skill);
      const start: WorkspaceAgentStart = agentStart(name, outcome.path, starter, skill);
      if (await this.fileOpener.reopenDirectory(outcome.path, start)) {
        this.opened.emit();
      } else {
        this.error.set(`${name} was made at ${outcome.path}, but it could not be opened.`);
      }
    } finally {
      this.creating.set(false);
    }
  }

  /**
   * Describes the repository the form asks for, for the main process.
   * @returns Returns the repository, or why it cannot be made yet.
   */
  private repositoryRequest(): NewProjectRepository | string {
    const choice: ProjectRepository | null = this.repository();
    const layout: ProjectLayout | null = this.layout();
    if (choice === 'none') {
      return { kind: 'none' };
    }
    if (choice === 'local') {
      return 'Studio cannot make a local repository yet. Choose no repository, or a hosted one.';
    }
    const account: ProjectAccount | undefined = this.accounts().find(
      (candidate: ProjectAccount): boolean => candidate.id === this.account(),
    );
    if (choice === null || layout === null || account === undefined) {
      return 'Finish the project details first.';
    }
    return {
      kind: 'hosted',
      host: account.host,
      account: account.login,
      private: choice === 'private',
      layout,
    };
  }
}

/**
 * Describes how a new project's agent starts: Studio's opening line, and the brief every turn carries —
 * what the project is and where it began, with the starter's skill when the library has it.
 * @param name The project's name.
 * @param path Where it is.
 * @param starter The starter it began from.
 * @param skill The starter's skill, when the library has it.
 * @returns Returns the start.
 */
export function agentStart(
  name: string,
  path: string,
  starter: ProjectStarter,
  skill: Skill | undefined,
): WorkspaceAgentStart {
  const brief: string[] = [
    `The user has just created a new project, "${name}", at ${path}. This workspace is that project; it is new and holds nothing the user wrote yet.`,
    `They started from "${starter.title}": ${starter.summary}`,
    'Help them plan the project before building it: ask about what it is for and how it should be made, one question at a time, and recommend an option when offering a choice. Follow them if they want to talk about something else. Ask before creating files.',
  ];
  if (skill !== undefined) {
    brief.push(`Follow the "${skill.name}" skill:\n\n${skill.body}`);
  }
  return {
    opening: `${name} is ready. Tell the agent about your project to start planning it.`,
    brief: brief.join('\n\n'),
  };
}

/**
 * Matches a name that can be a folder's: letters, digits, dots, hyphens and underscores, but not "."
 * or "..". The same rule as a clone's folder.
 */
const FOLDER_NAME: RegExp = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * Determines whether a value names a repository choice.
 * @param value The value.
 * @returns Returns true when it does.
 */
function isRepository(value: string): value is ProjectRepository {
  return value === 'none' || value === 'local' || value === 'public' || value === 'private';
}
