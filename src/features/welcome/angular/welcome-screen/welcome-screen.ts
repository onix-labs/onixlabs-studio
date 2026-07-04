import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { RecentItem, RecentItems } from '@features/welcome/angular/recent-items/recent-items';
import { RepositoryOpener } from '@shared/angular/services/repositories/repository-opener';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';

/**
 * Describes a recent-items filter pill.
 */
interface RecentFilter {
  /**
   * Gets the stable identifier of the filter.
   */
  readonly id: string;

  /**
   * Gets the pill's label.
   */
  readonly label: string;

  /**
   * Gets the pill's icon.
   */
  readonly icon: Icon;
}

/**
 * Holds sample recent items used to preview the redesigned welcome screen. The {@link RecentItems}
 * service is still an empty stub, so these stand in until the real file-open flow populates it; the
 * screen falls back to them whenever the live list is empty.
 */
const SAMPLE_RECENT: readonly RecentItem[] = [
  {
    id: 'sample-my-project',
    name: 'my-project',
    detail: '~/Projects/my-project',
    timestamp: 'Just now',
    icon: Icon.DIRECTORY,
  },
  {
    id: 'sample-studio-core',
    name: 'studio-core',
    detail: 'github.com/onixlabs/studio-core',
    timestamp: '2h ago',
    icon: Icon.SOURCE_CONTROL,
  },
  {
    id: 'sample-readme',
    name: 'README.md',
    detail: '~/Projects/my-project/README.md',
    timestamp: '5h ago',
    icon: Icon.MARKDOWN,
  },
  {
    id: 'sample-main-ts',
    name: 'main.ts',
    detail: '~/Projects/studio-core/src/main.ts',
    timestamp: 'Yesterday',
    icon: Icon.CODE,
  },
  {
    id: 'sample-design-system',
    name: 'design-system',
    detail: '~/Projects/design-system',
    timestamp: '2 days ago',
    icon: Icon.DIRECTORY,
  },
  {
    id: 'sample-changelog',
    name: 'CHANGELOG.md',
    detail: '~/Projects/studio-core/CHANGELOG.md',
    timestamp: '3 days ago',
    icon: Icon.MARKDOWN,
  },
];

/**
 * Represents the welcome screen: the entry surface that gets the user from a cold start into a tab.
 *
 * It renders full-bleed when no tabs are open, and as a dismissable modal over the existing content
 * when summoned from the title strip's new-tab button. Either way it presents the application
 * identity, the create/open actions, and the list of recent items. The backdrop, dismissal, and
 * animation are provided by the reusable {@link Modal}; the welcome screen overrides its theming for
 * the fixed dark, purple-accented panel and projects a static accent glow behind it.
 */
@Component({
  selector: 'app-welcome-screen',
  imports: [AppIcon, Modal],
  templateUrl: './welcome-screen.html',
  styleUrl: './welcome-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeScreen {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry the welcome actions open into.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the welcome modal state, dismissed once an action routes the user into a tab.
   */
  private readonly welcomeModal: WelcomeModal = inject(WelcomeModal);

  /**
   * Holds the opener that routes a chosen file or folder to the right surface.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the opener that opens a git repository into a source-control tab.
   */
  private readonly repositoryOpener: RepositoryOpener = inject(RepositoryOpener);

  /**
   * Holds the recent-items registry surfaced in the right-hand panel.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Gets the recent items shown in the right-hand panel, falling back to sample items while the
   * recent-items service is still an empty stub so the panel previews its populated design.
   */
  protected readonly recent: Signal<readonly RecentItem[]> = computed((): readonly RecentItem[] => {
    const live: readonly RecentItem[] = this.recentItems.items();
    return live.length > 0 ? live : SAMPLE_RECENT;
  });

  /**
   * Gets the recent-items filter pills. These are presentational for now: selecting one highlights it
   * but does not yet filter the list.
   */
  protected readonly filters: readonly RecentFilter[] = [
    { id: 'all', label: 'All', icon: Icon.GRID_DOTS },
    { id: 'directories', label: 'Directories', icon: Icon.FOLDER },
    { id: 'repositories', label: 'Repositories', icon: Icon.SOURCE_CONTROL },
    { id: 'markdown', label: 'Markdown', icon: Icon.MARKDOWN },
    { id: 'code', label: 'Code Files', icon: Icon.CODE },
  ];

  /**
   * Holds the currently selected filter pill (presentational only).
   */
  protected readonly activeFilter: WritableSignal<string> = signal<string>('all');

  /**
   * Gets a value indicating whether the welcome screen can be dismissed. It can only be dismissed
   * when at least one tab is open behind it; at a cold start there is nothing to return to.
   */
  protected readonly dismissable: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length > 0,
  );

  /**
   * Gets a value indicating whether the welcome screen is currently shown. The overlay stays mounted
   * so it can animate in and out; this drives its visible state. It is shown at a cold start (no tabs)
   * and whenever it is explicitly summoned as a modal over the content.
   */
  protected readonly visible: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length === 0 || this.welcomeModal.isOpen(),
  );

  /**
   * Gets a value indicating whether the ambient backdrop (the static accent glow) is shown. It appears
   * only at a cold start or when no tabs are open — never when the welcome screen is summoned as a modal
   * over existing content.
   */
  protected readonly ambient: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length === 0,
  );

  /**
   * Shows the system open dialog and routes the chosen file or folder: a directory opens in the
   * workspace, a markdown file in a markdown tab, and any other text file in a code tab. The welcome
   * screen is dismissed only when something was opened, so cancelling returns to it.
   */
  protected async openFiles(): Promise<void> {
    if (await this.fileOpener.openInteractive()) {
      this.welcomeModal.close();
    }
  }

  /**
   * Creates and activates a new tab of the given type, dismissing the welcome screen.
   * @param type The type of tab to create.
   */
  protected create(type: TabType): void {
    this.tabsService.open(type);
    this.welcomeModal.close();
  }

  /**
   * Shows the open-repository dialog and opens the chosen git repository in a source-control tab. The
   * welcome screen is dismissed only when a repository was opened, so cancelling returns to it.
   */
  protected async openRepository(): Promise<void> {
    if (await this.repositoryOpener.openInteractive()) {
      this.welcomeModal.close();
    }
  }

  /**
   * Closes the welcome screen when it is shown as a dismissable modal. Invoked by the modal's dismiss
   * output, which only fires when dismissal is permitted; the guard keeps it safe regardless.
   */
  protected close(): void {
    if (this.dismissable()) {
      this.welcomeModal.close();
    }
  }
}
