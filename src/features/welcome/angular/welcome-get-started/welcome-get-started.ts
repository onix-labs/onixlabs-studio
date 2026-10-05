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
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Log } from '@shared/angular/services/log/log';
import {
  RecentItem,
  RecentItems,
  RecentKind,
} from '@shared/angular/services/recent-items/recent-items';
import { Shell } from '@shared/angular/services/shell/shell';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * Describes a recent-items filter.
 */
interface RecentFilter {
  /**
   * Gets the stable identifier of the filter.
   */
  readonly id: string;

  /**
   * Gets the filter's label.
   */
  readonly label: string;

  /**
   * Gets the recent-item kind this filter shows, or null for everything.
   */
  readonly kind: RecentKind | null;
}

/**
 * Describes one of the Get Started actions.
 */
interface StartAction {
  /**
   * Gets the action's label.
   */
  readonly label: string;

  /**
   * Gets the action's icon.
   */
  readonly icon: Icon;

  /**
   * Gets what the action does: a tab to open, or one of the actions that is not a plain tab.
   */
  readonly run: TabType | 'open' | 'unavailable';
}

/**
 * The welcome screen's Get Started section: "I already know what I want to work on". The ways in on
 * the left — open something, or start a new file, terminal, agent or explorer — and the recent items
 * on the right, which can be filtered, searched, starred, re-opened, removed, or revealed in the file
 * manager.
 *
 * It does not dismiss the welcome screen itself: it reports what happened, and the screen decides.
 */
@Component({
  selector: 'app-welcome-get-started',
  imports: [AppIcon, Button, Dropdown, Modal, ModalContent, TooltipTrigger],
  templateUrl: './welcome-get-started.html',
  styleUrl: './welcome-get-started.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeGetStarted {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Emits the kind of tab an action asks for; the welcome screen opens it and steps aside.
   */
  public readonly openTab: OutputEmitterRef<TabType> = output<TabType>();

  /**
   * Emits when something was opened from here (a file, a folder, a recent item), so the welcome
   * screen can step aside.
   */
  public readonly opened: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the opener that routes a chosen file or folder to the right surface.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the recent-items registry.
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the Get Started actions, in order.
   */
  protected readonly actions: readonly StartAction[] = [
    { label: 'Open Directory or File', icon: Icon.WELCOME_DIRECTORY, run: 'open' },
    { label: 'New Code File', icon: Icon.WELCOME_CODE, run: 'code' },
    { label: 'New Markdown File', icon: Icon.WELCOME_MARKDOWN, run: 'markdown' },
    { label: 'New Terminal', icon: Icon.WELCOME_TERMINAL, run: 'terminal' },
    { label: 'New Agent', icon: Icon.WELCOME_AGENT, run: 'agent' },
    { label: 'New API Explorer', icon: Icon.WELCOME_API_EXPLORER, run: 'api-explorer' },
    { label: 'New Database Explorer', icon: Icon.WELCOME_DATABASE, run: 'unavailable' },
  ];

  /**
   * Gets the recent-items filters.
   */
  protected readonly filters: readonly RecentFilter[] = [
    { id: 'all', label: 'Everything', kind: null },
    { id: 'directories', label: 'Workspaces', kind: 'directory' },
    { id: 'markdown', label: 'Markdown', kind: 'markdown' },
    { id: 'code', label: 'Code', kind: 'code' },
    { id: 'images', label: 'Images', kind: 'image' },
    { id: 'binary', label: 'Binary', kind: 'binary' },
    { id: 'api', label: 'APIs', kind: 'api' },
  ];

  /**
   * Gets the filters as the dropdown lists them.
   */
  protected readonly filterOptions: readonly DropdownOption[] = this.filters.map(
    (filter: RecentFilter): DropdownOption => ({ value: filter.id, label: filter.label }),
  );

  /**
   * Holds the currently selected filter.
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
   * Gets a value indicating whether any recent items exist at all, regardless of the current filter
   * and search, distinguishing an empty history from a query that matched nothing.
   */
  protected readonly hasRecent: Signal<boolean> = computed(
    (): boolean => this.recentItems.items().length > 0,
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
   * Runs a Get Started action.
   * @param action The action.
   */
  protected run(action: StartAction): void {
    switch (action.run) {
      case 'open':
        void this.openFiles();
        return;
      case 'unavailable':
        // No feature behind this action yet; it is sketched here to shape the screen.
        this.log.info('welcome', `"${action.label}" is not available yet`);
        return;
      default:
        this.log.info('welcome', `Create new ${action.run} tab`);
        this.openTab.emit(action.run);
    }
  }

  /**
   * Gets a value indicating whether an action has nothing behind it yet.
   * @param action The action.
   * @returns Returns true for an action that is only sketched.
   */
  protected isUnavailable(action: StartAction): boolean {
    return action.run === 'unavailable';
  }

  /**
   * Prepares a name or path for display in the recent list. The list truncates on the left using an
   * RTL layout direction, which would otherwise reorder an absolute path's leading slash to the visual
   * end; prefixing a left-to-right mark keeps it in place. Any trailing slash is trimmed first.
   * @param value The raw name or path.
   * @returns Returns the value ready for left-truncated display.
   */
  protected display(value: string): string {
    const trimmed: string = value.replace(/\/+$/, '');
    return `‎${trimmed.length > 0 ? trimmed : value}`;
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
      case 'image':
        return Icon.IMAGE_FILE;
      case 'api':
        return Icon.API_EXPLORER;
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
   * Re-opens a recent item and, when it opened, reports it. A recent item's path is one the user has
   * opened before, so a failure to open it almost always means the file or folder has moved, been
   * renamed, or been deleted; rather than doing nothing, the user is asked what to do with it.
   * @param item The recent item to open.
   */
  protected async openRecent(item: RecentItem): Promise<void> {
    this.log.info('welcome', `Open recent ${item.kind}`, item.path);
    if (await this.reopen(item)) {
      this.opened.emit();
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
   * re-opened. On success the stale entry is dropped (the freshly opened path records its own entry)
   * and its pinned state is carried across. Cancelling the picker or failing to open leaves the prompt
   * up so the user can choose again, remove, or cancel.
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
    this.opened.emit();
  }

  /**
   * Toggles whether a recent item is starred. The row shows a star; the registry still calls it a pin,
   * which keeps every starred item at the top of the list.
   * @param item The recent item to pin or unpin.
   */
  protected togglePin(item: RecentItem): void {
    this.log.debug('welcome', `Toggle star (${item.pinned ? 'unstar' : 'star'})`, item.path);
    this.recentItems.togglePin(item.path);
  }

  /**
   * Shows a recent item in the file manager.
   * @param item The recent item.
   */
  protected reveal(item: RecentItem): void {
    this.log.info('welcome', 'Reveal recent item in file manager', item.path);
    void this.shell.revealPath(item.path);
  }

  /**
   * Removes a recent item from the list. The file or folder itself is untouched.
   * @param item The recent item.
   */
  protected remove(item: RecentItem): void {
    this.log.info('welcome', 'Remove recent item', item.path);
    this.recentItems.remove(item.path);
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
   * workspace, a markdown file in a markdown tab, and any other text file in a code tab. Reports only
   * when something was opened, so cancelling stays on the welcome screen.
   */
  private async openFiles(): Promise<void> {
    this.log.info('welcome', 'Open file/folder requested');
    if (await this.fileOpener.openInteractive()) {
      this.opened.emit();
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
      case 'image':
      case 'api':
        // Every file kind re-opens through the same door: the opener routes it by name, so an API
        // document lands in an API Explorer tab exactly as it did when it was first opened.
        return this.fileOpener.reopenFile(item.path);
    }
  }
}
