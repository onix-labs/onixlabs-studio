import { effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Holds whether Studio is dormant: its window was closed on macOS while it keeps running in the Dock.
 *
 * Dormant, nothing is on screen — not the main window, which has no tabs left to show, and not the
 * welcome screen, which would otherwise stand in for it. Clicking the Dock icon wakes Studio, and the
 * welcome screen comes back. Anything that opens a tab (a file opened from the Finder, say) wakes it
 * too.
 */
@Service()
export class Dormancy {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the backing state for {@link dormant}.
   */
  private readonly state: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether Studio is dormant.
   */
  public readonly dormant: Signal<boolean> = this.state.asReadonly();

  /**
   * Initializes the service, waking whenever a tab opens.
   */
  public constructor() {
    const tabs: Tabs = inject(Tabs);
    effect((): void => {
      if (tabs.tabs().length > 0 && this.state()) {
        this.wake();
      }
    });
  }

  /**
   * Makes Studio dormant: nothing is shown until it is woken.
   */
  public sleep(): void {
    this.log.info('Dormancy', 'Window closed; Studio keeps running');
    this.state.set(true);
  }

  /**
   * Wakes Studio, so the welcome screen shows again when no tabs are open.
   */
  public wake(): void {
    if (this.state()) {
      this.log.info('Dormancy', 'Studio woken');
      this.state.set(false);
    }
  }
}
