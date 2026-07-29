import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  viewChild,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { TabCloser } from '@shared/angular/services/tab-closer/tab-closer';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * Pairs a category heading with the open tabs that fall under it, for the grouped tab menu.
 */
interface TabGroup {
  /**
   * Gets the category heading shown above the group.
   */
  readonly label: string;

  /**
   * Gets the open tabs belonging to the category, in their tab-strip order.
   */
  readonly tabs: readonly Tab[];
}

/**
 * Specifies the categories the open tabs are grouped under in the menu, in display order. Each entry
 * pairs a {@link TabType} with the plural heading shown above its tabs; categories with no open tabs
 * are omitted from the menu.
 */
const TAB_CATEGORIES: readonly { readonly type: TabType; readonly label: string }[] = [
  { type: 'directory', label: 'Workspaces' },
  { type: 'code', label: 'Code Files' },
  { type: 'markdown', label: 'Markdown Files' },
  { type: 'terminal', label: 'Terminals' },
  { type: 'agent', label: 'Agents' },
  { type: 'settings', label: 'Settings' },
];

/**
 * The title strip's tab menu: a trigger in the title-strip button group that opens a drop-down
 * listing every open tab, grouped by category (workspaces, repositories, code files, and so on).
 * Selecting an entry activates that tab, which makes tabs reachable even once the strip overflows and
 * begins to scroll. It doubles as the agent-requests inbox (#253): pending requests render under
 * their hosting tab's entry with inline answers, the trigger becomes an accent bell while any wait,
 * and the menu's left edge is aligned with the trigger's left edge.
 */
@Component({
  selector: 'app-title-strip-tab-menu',
  imports: [Button, AppIcon, CdkMenuTrigger, CdkMenu, CdkMenuItem],
  templateUrl: './title-strip-tab-menu.html',
  styleUrl: './title-strip-tab-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripTabMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry that backs the menu.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the app-wide agent-requests registry the menu surfaces.
   */
  private readonly agentRequests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the tab closer that resolves unsaved changes before removing a tab.
   */
  private readonly tabCloser: TabCloser = inject(TabCloser);

  /**
   * Holds the settings store, read for the toggle that shows or hides agent requests here.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets whether agent requests surface in this menu at all (the bell, the per-tab markers, and the
   * inline request entries). When off, the menu is a plain tab list and requests are answered in the
   * conversation (or surfaced as toasts when that setting is on).
   */
  private readonly showRequests: Signal<boolean> = this.settings.value(
    'notifications.agentRequestsInTabList',
  );

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;

  /**
   * Gets the open tabs grouped by category, omitting categories with no open tabs, so the menu lists
   * only the categories that are actually present.
   */
  protected readonly groups: Signal<readonly TabGroup[]> = computed((): readonly TabGroup[] => {
    const open: readonly Tab[] = this.tabsService.tabs();
    return TAB_CATEGORIES.map(
      (category: { readonly type: TabType; readonly label: string }): TabGroup => ({
        label: category.label,
        tabs: open.filter((tab: Tab): boolean => tab.type === category.type),
      }),
    ).filter((group: TabGroup): boolean => group.tabs.length > 0);
  });

  /**
   * Gets the position that opens the menu below the trigger with their left edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['down-start'];

  /**
   * References the menu trigger, so the menu can dismiss itself once the last request settles.
   */
  private readonly menuTrigger: Signal<CdkMenuTrigger | undefined> = viewChild(CdkMenuTrigger);

  /**
   * Gets the pending agent requests, keyed by their hosting tab, so each renders under its tab's
   * entry in the grouped list.
   */
  protected readonly entriesByTab: Signal<ReadonlyMap<string, readonly AgentRequestEntry[]>> =
    computed((): ReadonlyMap<string, readonly AgentRequestEntry[]> => {
      const map: Map<string, AgentRequestEntry[]> = new Map<string, AgentRequestEntry[]>();
      if (!this.showRequests()) {
        return map;
      }
      for (const entry of this.agentRequests.entries()) {
        if (entry.tabId !== null) {
          const list: AgentRequestEntry[] = map.get(entry.tabId) ?? [];
          list.push(entry);
          map.set(entry.tabId, list);
        }
      }
      return map;
    });

  /**
   * Gets the pending requests with no hosting tab (the workspace and repository agent panels),
   * listed under their own trailing heading.
   */
  protected readonly unattributed: Signal<readonly AgentRequestEntry[]> = computed(
    (): readonly AgentRequestEntry[] =>
      this.showRequests()
        ? this.agentRequests
            .entries()
            .filter((entry: AgentRequestEntry): boolean => entry.tabId === null)
        : [],
  );

  /**
   * Initializes a new instance of the {@link TitleStripTabMenu} class, wiring the self-dismiss: when
   * the last pending request settles (from this menu or anywhere else), an open menu closes — but a
   * menu opened as a plain tab list (no requests) is left alone.
   */
  public constructor() {
    let previous: number = 0;
    effect((): void => {
      const count: number = this.requestCount();
      if (previous > 0 && count === 0) {
        this.menuTrigger()?.close();
      }
      previous = count;
    });
  }

  /**
   * Gets the pending requests hosted by a tab.
   * @param tabId The tab identifier.
   * @returns Returns the tab's pending requests (empty for none).
   */
  protected entriesFor(tabId: string): readonly AgentRequestEntry[] {
    return this.entriesByTab().get(tabId) ?? [];
  }

  /**
   * Gets the number of pending agent requests, flipping the trigger from chevron to bell. Zero
   * whenever the tab-list surfacing is switched off, so the trigger stays a plain chevron.
   */
  protected readonly requestCount: Signal<number> = computed((): number =>
    this.showRequests() ? this.agentRequests.count() : 0,
  );

  /**
   * Gets the identifiers of the tabs with pending requests, marked with a bell in the tab list.
   */
  protected readonly requestTabIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> =>
      this.showRequests() ? this.agentRequests.tabIds() : new Set<string>(),
  );

  /**
   * Gets the trigger's tooltip: the open-tabs default, or the pending-request count.
   */
  protected readonly triggerTitle: Signal<string> = computed((): string => {
    const count: number = this.requestCount();
    return count === 0
      ? 'Open tabs'
      : count === 1
        ? '1 agent request waiting'
        : `${count} agent requests waiting`;
  });

  /**
   * Renders the heading line of a request entry: what kind of request it is.
   * @param entry The request entry.
   * @returns Returns the heading.
   */
  protected requestHeading(entry: AgentRequestEntry): string {
    switch (entry.item.kind) {
      case 'permission':
        return `Allow ${entry.item.permissionName ?? 'a tool'}?`;
      case 'edit-decision':
        return `Apply an edit to ${entry.item.decisionName ?? 'a document'}?`;
      default:
        return entry.item.inputQuestion ?? 'The agent has a question.';
    }
  }

  /**
   * Answers a permission request from the list (a one-off grant or denial; scoped remembering lives
   * on the transcript card).
   * @param entry The request entry.
   * @param granted Whether the user granted permission.
   */
  protected onPermission(entry: AgentRequestEntry, granted: boolean): void {
    this.settle((): void => entry.agent.respondPermission(entry.item, granted));
  }

  /**
   * Answers an edit decision from the list.
   * @param entry The request entry.
   * @param choice The decision.
   */
  protected onEditDecision(entry: AgentRequestEntry, choice: 'yes' | 'yes-auto' | 'no'): void {
    this.settle((): void => entry.agent.respondEditDecision(entry.item, choice));
  }

  /**
   * Answers a question from the list with one of its suggested choices, or declines it.
   * @param entry The request entry.
   * @param answer The chosen answer, or null to decline.
   */
  protected onAnswer(entry: AgentRequestEntry, answer: string | null): void {
    this.settle((): void => entry.agent.respondInput(entry.item, answer));
  }

  /**
   * Runs an answer after the current click cycle completes, as one of two defences that keep the
   * menu open while requests remain (a CdkMenu closes itself when it loses focus, and an answered
   * entry's removal would otherwise take the focus down with it). The other is on the buttons
   * themselves: pointerdown is prevented so they never take focus in the first place.
   * @param respond The answer to apply.
   */
  private settle(respond: () => void): void {
    setTimeout(respond, 0);
  }

  /**
   * Activates the tab hosting a request, so a free-form question (or an edit's diff) can be handled
   * in context.
   * @param entry The request entry.
   */
  protected onOpenRequest(entry: AgentRequestEntry): void {
    if (entry.tabId !== null) {
      this.tabsService.activate(entry.tabId);
    }
  }

  /**
   * Activates the given tab, bringing it into view in the tab strip.
   * @param tab The tab to activate.
   */
  protected onSelect(tab: Tab): void {
    this.tabsService.activate(tab.id);
  }

  /**
   * Closes the given tab. The menu stays open so several tabs can be closed in succession; its
   * grouped list updates as tabs (and emptied categories) fall away.
   * @param tab The tab to close.
   */
  protected onClose(tab: Tab): void {
    void this.tabCloser.close(tab.id);
  }
}
