import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The AI Manager's sub-views, in the order its ribbon lists them.
 */
export type AiManagerSection = 'models' | 'profiles' | 'skills';

/**
 * The deep-link seam for the AI Manager tab (#948), the counterpart of the Settings tab's own. The
 * manager is a singleton whose sub-view lives here rather than in the view, so a button elsewhere —
 * Settings' AI entries, the welcome screen — can land the user on one whether the tab is already
 * open or opened by the same call, and the ribbon, which chooses the sub-view, shares it.
 */
@Service()
export class AiManagerNavigation {
  /**
   * Holds the tab registry, used to open (or activate) the singleton AI Manager tab.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the section shown.
   */
  private readonly sectionState: WritableSignal<AiManagerSection> =
    signal<AiManagerSection>('models');

  /**
   * Gets the section shown.
   */
  public readonly section: Signal<AiManagerSection> = this.sectionState.asReadonly();

  /**
   * Shows a section in the AI Manager, without opening the tab.
   * @param section The section to show.
   */
  public show(section: AiManagerSection): void {
    this.sectionState.set(section);
  }

  /**
   * Opens the AI Manager tab at a section. If the tab is already open it is activated.
   * @param section The section to show.
   */
  public open(section: AiManagerSection): void {
    this.sectionState.set(section);
    this.tabs.open('model-manager');
    this.log.info('AiManagerNavigation', `Opened the AI Manager at '${section}'`);
  }
}
