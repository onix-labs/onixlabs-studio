import { effect, inject, Service } from '@angular/core';
import { Studio } from '@shared/angular/services/studio/studio';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Governs whether the main window is on screen at all.
 *
 * The IDE window exists to show tabs. With none open there is nothing to show — the welcome screen
 * stands in for the application, in its own window — so the main window hides rather than sitting
 * empty behind it. Opening anything brings it back. At a cold start this is what keeps an empty IDE
 * window from flashing before the welcome screen: the main window starts hidden and is only shown
 * from here.
 *
 * Instantiated by the shell, which is the one place that owns the window's presence.
 */
@Service()
export class ShellPresence {
  /**
   * Holds the window controls.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the tab registry whose emptiness decides the window's presence.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Initializes a new instance of the {@link ShellPresence} class, tracking the main window's
   * presence against the open tabs.
   */
  public constructor() {
    effect((): void => {
      if (this.tabs.tabs().length > 0) {
        this.studio.showWindow();
      } else {
        this.studio.hideWindow();
      }
    });
  }
}
