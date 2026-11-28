import { DestroyRef, effect, inject } from '@angular/core';
import { SHELL_WINDOW, Tabs } from '@shared/angular/services/tabs/tabs';
import { AppMenu } from './app-menu';
import { MenuContribution } from './app-menu-model';

/**
 * Orders a feature's contribution between the core's leading and trailing sections, so a feature's Save
 * lands after File's New and Open and before its Close Tab.
 */
const FEATURE_MENU_PRIORITY: number = 500;

/**
 * Contributes the active feature's menu sections for as long as its ribbon is mounted.
 *
 * A ribbon is mounted only for the active tab, which is exactly the lifetime a contextual menu wants:
 * the contribution follows the tab into view and is withdrawn when another takes its place, so the menu
 * always describes what is actually in front. It also puts the menu next to the handlers it runs — the
 * ribbon already holds them — rather than duplicating them somewhere else.
 *
 * With several Studio windows (#1587), every window mounts its own ribbon, but the menu bar describes
 * the window in front: each window's contribution is kept under its own name and offered only while
 * that window is in front, so two windows never show their sections side by side, and closing one
 * never takes the other's away.
 *
 * Call from an injection context (a component field initializer or constructor). The sections are read
 * through a callback rather than passed by value so enablement and checkboxes stay live: the effect
 * re-contributes whenever any signal the callback reads changes.
 * @param ownerId The contributing feature's identifier.
 * @param sections Builds the feature's sections; re-read whenever its dependencies change.
 */
export function contributeFeatureMenu(
  ownerId: string,
  sections: () => readonly MenuContribution[],
): void {
  const menu: AppMenu = inject(AppMenu);
  const tabs: Tabs = inject(Tabs);
  const windowId: string = inject(SHELL_WINDOW);
  const destroyRef: DestroyRef = inject(DestroyRef);
  const owner: string = `${ownerId}@${windowId}`;
  effect((): void => {
    if (tabs.focusedWindow() === windowId) {
      menu.contribute(owner, sections(), FEATURE_MENU_PRIORITY);
    } else {
      menu.clearOwner(owner);
    }
  });
  destroyRef.onDestroy((): void => menu.clearOwner(owner));
}
