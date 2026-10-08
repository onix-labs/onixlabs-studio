import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { installedContributions } from '@shared/api/plugin-channels';
import { Clone } from '@shared/angular/services/clone/clone';
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
 * The welcome screen's Create Something section: an optional form — a project's name, where it goes
 * and its repository — and the starters that open a project agent. It hosts no conversation itself.
 *
 * Filled in, the form decides that a workspace is made first and the agent opens inside it; left
 * empty, the agent opens in its own tab and asks for those details when the project needs a home. The
 * starter chosen decides only which skill the agent begins with, from the most general ("Create
 * Something") to the specific.
 *
 * ⚠️ A layout preview: the starters are a fixed list rather than the skill library's, and starting
 * says what would happen instead of doing it.
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
   * Holds what starting would have done, said in place of doing it while this is a preview.
   */
  protected readonly preview: WritableSignal<string | null> = signal<string | null>(null);

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
      (this.repository() === 'none' || this.layout() !== null),
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
   * Starts with the folder clones go into, the one the user chose last.
   */
  public ngOnInit(): void {
    void this.cloner.parent().then((parent: string | null): void => {
      if (this.location() === null) {
        this.location.set(parent);
      }
    });
  }

  /**
   * Updates the name from the input event.
   * @param event The input event carrying the current value.
   */
  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.preview.set(null);
  }

  /**
   * Asks where the project goes, in the main process's folder dialog.
   * @returns Resolves once the dialog has closed.
   */
  protected async browse(): Promise<void> {
    const chosen: string | null = await this.cloner.pickParent();
    if (chosen !== null) {
      this.location.set(chosen);
      this.preview.set(null);
    }
  }

  /**
   * Records the repository picked.
   * @param value The picked value.
   */
  protected setRepository(value: string): void {
    this.repository.set(isRepository(value) ? value : null);
    this.preview.set(null);
  }

  /**
   * Records the layout picked.
   * @param value The picked value.
   */
  protected setLayout(value: string): void {
    this.layout.set(value === 'flat' || value === 'worktree' ? value : null);
    this.preview.set(null);
  }

  /**
   * Starts a project agent with a starter's skill: in a new workspace when the form is complete, in
   * its own tab otherwise. A preview for now: it says which, rather than doing it.
   * @param starter The starter.
   */
  protected start(starter: ProjectStarter): void {
    const where: string = this.complete()
      ? `open a new workspace at ${this.target()}`
      : 'open an agent tab, which asks where the project goes later';
    this.log.info('welcome', `Project agent "${starter.skill}" requested (preview only)`);
    this.preview.set(`Preview: this would ${where}, starting from the “${starter.title}” skill.`);
  }
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
