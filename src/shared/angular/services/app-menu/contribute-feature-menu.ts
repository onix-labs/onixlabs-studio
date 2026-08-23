import { DestroyRef, effect, inject } from '@angular/core';
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
  const destroyRef: DestroyRef = inject(DestroyRef);
  effect((): void => {
    menu.contribute(ownerId, sections(), FEATURE_MENU_PRIORITY);
  });
  destroyRef.onDestroy((): void => menu.clearOwner(ownerId));
}
