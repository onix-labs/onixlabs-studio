import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
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
import { Button } from '@shared/angular/components/forms/button/button';
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
 * Names the collapsible action groups in the left column.
 */
type WelcomeGroup = 'get-started' | 'tools';

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
  imports: [AppIcon, Button, Modal, ModalContent, Menu, CdkMenuTrigger],
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
   * Holds the recent-items registry surfaced in the right-hand panel.
   */
  private readonly recentItems: RecentItems = inject(RecentItems);

  /**
   * Holds the file client, used to pick a replacement location for a recent item that has moved.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

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
   * Holds the structured logger for welcome-screen actions.
   */
  private readonly log: Log = inject(Log);

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
   * Holds which left-column group is expanded, or null when both are collapsed. The groups behave as
   * a single-open accordion; Get Started is open at first.
   */
  protected readonly openGroup: WritableSignal<WelcomeGroup | null> =
    signal<WelcomeGroup | null>('get-started');

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
   * Holds the recent item that could not be opened — moved, renamed, or deleted since it was last
   * used — while the user is asked what to do with it, or null when no such prompt is shown.
   */
  protected readonly missingItem: WritableSignal<RecentItem | null> = signal<RecentItem | null>(
    null,
  );

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
   * Holds a value indicating whether an open or new action has just dismissed the welcome screen.
   * The screen otherwise follows the tab count, which only rises once the action's async work has
   * registered its tab — long enough, intermittently, to leave the screen lingering empty in the
   * gap. Latching this the moment an action fires hides it at once instead. It is derived from the
   * underlying show condition so the latch clears itself whenever that condition next changes (a tab
   * appears, or the last one closes), letting the screen show again the next time it is summoned.
   */
  protected readonly dismissed: WritableSignal<boolean> = linkedSignal<boolean, boolean>({
    source: (): boolean => this.tabsService.tabs().length === 0 || this.welcomeModal.isOpen(),
    computation: (): boolean => false,
  });

  /**
   * Gets a value indicating whether the welcome screen is currently shown. The overlay stays mounted
   * so it can animate in and out; this drives its visible state. It is shown at a cold start (no tabs)
   * and whenever it is explicitly summoned as a modal over the content, unless an action has just
   * dismissed it.
   */
  protected readonly visible: Signal<boolean> = computed(
    (): boolean =>
      !this.dismissed() && (this.tabsService.tabs().length === 0 || this.welcomeModal.isOpen()),
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
   * Re-opens a recent item and, when it opened, dismisses the welcome screen. A recent item's path is
   * one the user has opened before, so a failure to open it almost always means the file or folder has
   * moved, been renamed, or been deleted; rather than doing nothing, the user is asked what to do with
   * the now-missing item.
   * @param item The recent item to open.
   */
  protected async openRecent(item: RecentItem): Promise<void> {
    this.log.info('welcome', `Open recent ${item.kind}`, item.path);
    if (await this.reopen(item)) {
      this.dismissed.set(true);
      this.welcomeModal.close();
    } else {
      this.log.warn('welcome', 'Recent item could not be opened; prompting to locate', item.path);
      this.missingItem.set(item);
    }
  }

  /**
   * Dismisses the missing-item prompt, leaving the recent item in place so the user can try again.
   */
  protected dismissMissing(): void {
    this.missingItem.set(null);
  }

  /**
   * Removes the missing recent item from the list and dismisses the prompt.
   */
  protected removeMissing(): void {
    const item: RecentItem | null = this.missingItem();
    if (item !== null) {
      this.log.info('welcome', 'Removed missing recent item', item.path);
      this.recentItems.remove(item.path);
    }
    this.missingItem.set(null);
  }

  /**
   * Lets the user point the missing recent item at its new location: a file picker (matching the item's
   * kind) is shown, and the chosen path — now trusted because the user picked it through the dialog — is
   * re-opened. On success the stale entry is dropped (the freshly opened path records its own entry),
   * its pinned state is carried across, and the welcome screen is dismissed. Cancelling the picker or
   * failing to open leaves the prompt up so the user can choose again, remove, or cancel.
   */
  protected async locateMissing(): Promise<void> {
    const item: RecentItem | null = this.missingItem();
    if (item === null) {
      return;
    }
    const located: string | null = await this.fileSystem.pickPath(
      item.kind === 'directory' ? 'folder' : 'file',
    );
    if (located === null) {
      return;
    }
    this.log.info('welcome', 'Relocating missing recent item', item.path, located);
    const opened: boolean =
      item.kind === 'directory'
        ? await this.fileOpener.reopenDirectory(located)
        : await this.fileOpener.reopenFile(located);
    if (!opened) {
      return;
    }
    if (item.pinned && located !== item.path) {
      this.recentItems.togglePin(located);
    }
    this.recentItems.remove(item.path);
    this.missingItem.set(null);
    this.welcomeModal.close();
  }

  /**
   * Toggles whether a recent item is pinned.
   * @param item The recent item to pin or unpin.
   */
  protected togglePin(item: RecentItem): void {
    this.log.debug('welcome', `Toggle pin (${item.pinned ? 'unpin' : 'pin'})`, item.path);
    this.recentItems.togglePin(item.path);
  }

  /**
   * Handles a selection from a row's overflow menu.
   * @param item The row the menu belongs to.
   * @param action The id of the chosen action.
   */
  protected onRowAction(item: RecentItem, action: string): void {
    if (action === ROW_ACTION_REMOVE) {
      this.log.info('welcome', 'Remove recent item', item.path);
      this.recentItems.remove(item.path);
    } else if (action === ROW_ACTION_REVEAL) {
      this.log.info('welcome', 'Reveal recent item in file manager', item.path);
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
    this.log.info('welcome', 'Cleared all recent items');
    this.recentItems.clear();
    this.confirmingClear.set(false);
  }

  /**
   * Shows the system open dialog and routes the chosen file or folder: a directory opens in the
   * workspace, a markdown file in a markdown tab, and any other text file in a code tab. The welcome
   * screen is dismissed only when something was opened, so cancelling returns to it.
   */
  protected async openFiles(): Promise<void> {
    this.log.info('welcome', 'Open file/folder requested');
    if (await this.fileOpener.openInteractive()) {
      this.dismissed.set(true);
      this.welcomeModal.close();
    }
  }

  /**
   * Creates a new project workspace. Placeholder pending the project-creation flow; wiring is deferred
   * until that feature lands, so this currently takes no action.
   */
  protected newProject(): void {
    this.log.info('welcome', 'New project requested (not yet implemented)');
    // No project-creation flow exists yet; this action is a design placeholder.
  }

  /**
   * Toggles a left-column group: opens it (collapsing the other), or collapses it when it is already
   * open — so at most one group is expanded at a time.
   * @param group The group to toggle.
   */
  protected toggleGroup(group: WelcomeGroup): void {
    this.log.debug('welcome', `Toggle group "${group}"`);
    this.openGroup.update((current: WelcomeGroup | null): WelcomeGroup | null =>
      current === group ? null : group,
    );
  }

  /**
   * Placeholder for a tool that does not exist yet (the AI Model Manager). Wiring is deferred until
   * the feature lands; for now the action takes no effect.
   */
  protected comingSoon(): void {
    this.log.info('welcome', 'Coming-soon tool clicked');
    // No feature behind this tool yet; it is sketched on the welcome screen to shape the dialog.
  }

  /**
   * Creates and activates a new tab of the given type, dismissing the welcome screen.
   * @param type The type of tab to create.
   */
  protected create(type: TabType): void {
    this.log.info('welcome', `Create new ${type} tab`);
    this.dismissed.set(true);
    this.welcomeModal.close();
    this.tabsService.open(type);
  }

  /**
   * Handles the welcome screen being dismissed. With tabs open it simply closes, returning to them.
   * With none, the welcome window is all there is — dismissal can only have come from closing that
   * window — so the application closes too, through the main window's own close (and therefore its
   * quit-confirmation protocol).
   */
  protected close(): void {
    if (this.dismissable()) {
      this.log.debug('welcome', 'Welcome screen dismissed to tabs');
      this.welcomeModal.close();
    } else {
      this.log.info('welcome', 'Welcome window closed; closing application');
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
        // Repository recents were folded into this on load (ruling 3 of #351): the unified workspace
        // view carries the Git preset, so a repository is just a directory Git happens to know.
        return this.fileOpener.reopenDirectory(item.path);
      case 'markdown':
      case 'code':
      case 'binary':
        return this.fileOpener.reopenFile(item.path);
    }
  }
}
