import { CdkMenuTrigger } from '@angular/cdk/menu';
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
import {
  RecentItem,
  RecentItems,
  RecentKind,
} from '@shared/angular/services/recent-items/recent-items';
import { Shell } from '@shared/angular/services/shell/shell';
import { Studio } from '@shared/angular/services/studio/studio';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';

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

  /**
   * Gets the recent-item kind this pill shows, or null for the "all" pill.
   */
  readonly kind: RecentKind | null;
}

/**
 * The ids emitted by the per-row overflow menu.
 */
const ROW_ACTION_REVEAL: string = 'reveal';
const ROW_ACTION_REMOVE: string = 'remove';

/**
 * Represents the welcome screen: the entry surface that gets the user from a cold start into a tab.
 *
 * It is presented in its own window by the reusable {@link Modal}, in one of two roles. With no tabs
 * open it IS the application: the main window is hidden, the welcome window stands free of it with
 * no backdrop, and closing that window closes the application. Summoned from the title strip's
 * new-tab button it is an ordinary modal over a blurred main window, dismissed back to the tabs
 * behind it. Either way it presents the application identity, the create/open actions, and the list
 * of recent items — which can be filtered, searched, pinned, re-opened, removed, or revealed in the
 * file manager. The welcome screen overrides the modal's theming for a purple-accented panel (a dark
 * treatment and a clean light-mode variant) and draws a static accent glow behind its content.
 */
@Component({
  selector: 'app-welcome-screen',
  imports: [AppIcon, Modal, ModalContent, Menu, CdkMenuTrigger],
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
  /**
   * Holds the recent-items registry surfaced in the right-hand panel.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the operating-system shell client, used to reveal an item in the file manager.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the window controls, used to close the application when the welcome window is closed while
   * it is all there is.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Gets a value indicating whether any recent items exist at all, regardless of the current filter
   * and search, distinguishing an empty history from a query that matched nothing.
   */
  protected readonly hasRecent: Signal<boolean> = computed(
    (): boolean => this.recentItems.items().length > 0,
  );

  /**
   * Gets the recent-items filter pills.
   */
  protected readonly filters: readonly RecentFilter[] = [
    { id: 'all', label: 'Everything', icon: Icon.GRID_DOTS, kind: null },
    { id: 'directories', label: 'Workspaces', icon: Icon.FOLDER, kind: 'directory' },
    { id: 'repositories', label: 'Repositories', icon: Icon.SOURCE_CONTROL, kind: 'repository' },
    { id: 'markdown', label: 'Markdown', icon: Icon.MARKDOWN, kind: 'markdown' },
    { id: 'code', label: 'Code', icon: Icon.CODE, kind: 'code' },
    { id: 'binary', label: 'Binary', icon: Icon.BINARY, kind: 'binary' },
  ];

  /**
   * Gets the actions shown in each row's overflow menu.
   */
  protected readonly rowMenuItems: readonly MenuItem[] = [
    { id: ROW_ACTION_REVEAL, label: 'Show in Finder', icon: Icon.FOLDER_OPEN },
    { id: ROW_ACTION_REMOVE, label: 'Remove Item', icon: Icon.TRASH },
  ];

  /**
   * Holds the currently selected filter pill.
   */
  protected readonly activeFilter: WritableSignal<string> = signal<string>('all');

  /**
   * Holds the current search query.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether the "clear all recent items" confirmation is shown.
   */
  protected readonly confirmingClear: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the recent items to show, narrowed by the active filter and search query and ordered with
   * pinned items first, then most-recently opened.
   */
  protected readonly visibleItems: Signal<readonly RecentItem[]> = computed(
    (): readonly RecentItem[] => {
      const kind: RecentKind | null =
        this.filters.find((filter: RecentFilter): boolean => filter.id === this.activeFilter())
          ?.kind ?? null;
      const needle: string = this.query().trim().toLowerCase();
      const matched: readonly RecentItem[] = this.recentItems
        .items()
        .filter((item: RecentItem): boolean => {
          if (kind !== null && item.kind !== kind) {
            return false;
          }
          if (needle.length === 0) {
            return true;
          }
          return (
            item.name.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle)
          );
        });
      return [...matched].sort((a: RecentItem, b: RecentItem): number => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return b.openedAt - a.openedAt;
      });
    },
  );

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
   * Gets a value indicating whether the welcome screen is standing in for the application rather
   * than being summoned over it: no tabs are open, so the main window is hidden and the welcome
   * window stands free of it.
   */
  protected readonly standsAlone: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length === 0,
  );

  /**
   * Prepares a name or path for display in the recent list. The list truncates on the left using an
   * RTL layout direction, which would otherwise reorder an absolute path's leading slash to the visual
   * end; prefixing a left-to-right mark keeps it in place. Any trailing slash is trimmed first.
   * @param value The raw name or path.
   * @returns Returns the value ready for left-truncated display.
   */
  protected display(value: string): string {
    const trimmed: string = value.replace(/\/+$/, '');
    return `\u200E${trimmed.length > 0 ? trimmed : value}`;
  }

  /**
   * Resolves the icon for a recent item's kind.
   * @param kind The recent item's kind.
   * @returns Returns the icon representing the kind.
   */
  protected iconFor(kind: RecentKind): Icon {
    switch (kind) {
      case 'directory':
        return Icon.DIRECTORY;
      case 'repository':
        return Icon.SOURCE_CONTROL;
      case 'markdown':
        return Icon.MARKDOWN;
      case 'code':
        return Icon.CODE;
      case 'binary':
        return Icon.BINARY;
    }
  }

  /**
   * Formats how long ago an item was opened as a short, human-readable label.
   * @param openedAt The epoch-millisecond timestamp the item was opened at.
   * @returns Returns a relative-time label such as "Just now", "2h ago", or "3 days ago".
   */
  protected relativeTime(openedAt: number): string {
    const minute: number = 60_000;
    const hour: number = 60 * minute;
    const day: number = 24 * hour;
    const diff: number = Math.max(0, Date.now() - openedAt);
    if (diff < minute) {
      return 'Just now';
    }
    if (diff < hour) {
      return `${Math.floor(diff / minute)}m ago`;
    }
    if (diff < day) {
      return `${Math.floor(diff / hour)}h ago`;
    }
    const days: number = Math.floor(diff / day);
    if (days === 1) {
      return 'Yesterday';
    }
    if (days < 7) {
      return `${days} days ago`;
    }
    if (days < 30) {
      return `${Math.floor(days / 7)}w ago`;
    }
    if (days < 365) {
      return `${Math.floor(days / 30)}mo ago`;
    }
    return `${Math.floor(days / 365)}y ago`;
  }

  /**
   * Re-opens a recent item and, when it opened, dismisses the welcome screen.
   * @param item The recent item to open.
   */
  protected async openRecent(item: RecentItem): Promise<void> {
    if (await this.reopen(item)) {
      this.welcomeModal.close();
    }
  }

  /**
   * Toggles whether a recent item is pinned.
   * @param item The recent item to pin or unpin.
   */
  protected togglePin(item: RecentItem): void {
    this.recentItems.togglePin(item.path);
  }

  /**
   * Handles a selection from a row's overflow menu.
   * @param item The row the menu belongs to.
   * @param action The id of the chosen action.
   */
  protected onRowAction(item: RecentItem, action: string): void {
    if (action === ROW_ACTION_REMOVE) {
      this.recentItems.remove(item.path);
    } else if (action === ROW_ACTION_REVEAL) {
      void this.shell.revealPath(item.path);
    }
  }

  /**
   * Updates the search query from the input event.
   * @param event The input event carrying the current value.
   */
  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Opens the confirmation asking whether every recent item should be cleared.
   */
  protected requestClearRecent(): void {
    this.confirmingClear.set(true);
  }

  /**
   * Dismisses the clear-recent-items confirmation without clearing anything.
   */
  protected cancelClearRecent(): void {
    this.confirmingClear.set(false);
  }

  /**
   * Clears every recent item and dismisses the confirmation.
   */
  protected clearRecent(): void {
    this.recentItems.clear();
    this.confirmingClear.set(false);
  }

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
   * Creates a new project workspace. Placeholder pending the project-creation flow; wiring is deferred
   * until that feature lands, so this currently takes no action.
   */
  protected newProject(): void {
    // No project-creation flow exists yet; this action is a design placeholder.
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
   * Handles the welcome screen being dismissed. With tabs open it simply closes, returning to them.
   * With none, the welcome window is all there is — dismissal can only have come from closing that
   * window — so the application closes too, through the main window's own close (and therefore its
   * quit-confirmation protocol).
   */
  protected close(): void {
    if (this.dismissable()) {
      this.welcomeModal.close();
    } else {
      this.studio.closeWindow();
    }
  }

  /**
   * Re-opens a recent item by routing it to the same surface it was first opened on.
   * @param item The recent item to open.
   * @returns Returns true when the item was opened; otherwise, false.
   */
  private reopen(item: RecentItem): Promise<boolean> {
    switch (item.kind) {
      case 'directory':
        return this.fileOpener.reopenDirectory(item.path);
      case 'repository':
        // A retired repository recent opens as an ordinary folder (ruling 3 of #351): the unified
        // workspace view carries the Git preset, so nothing is lost.
        return this.fileOpener.reopenDirectory(item.path);
      case 'markdown':
      case 'code':
      case 'binary':
        return this.fileOpener.reopenFile(item.path);
    }
  }
}
