import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The AI Manager's sub-views, in the order its ribbon lists them.
 */
export type AiManagerSection = 'models' | 'profiles' | 'skills';

/**
 * The sub-views, for checking a remembered one still is one.
 */
const AI_MANAGER_SECTIONS: readonly AiManagerSection[] = ['models', 'profiles', 'skills'];

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
   * Holds the settings, which remember the section left open.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the section shown, or null when none is: every section of the sidebar is closed and the
   * main area shows the overview.
   */
  private readonly sectionState: WritableSignal<AiManagerSection | null> =
    signal<AiManagerSection | null>(null);

  /**
   * Holds whether the AI Manager was opened at a section on purpose, so the view keeps it open rather
   * than starting with every section closed.
   */
  private requested: boolean = false;

  /**
   * Gets the section shown, or null when none is.
   */
  public readonly section: Signal<AiManagerSection | null> = this.sectionState.asReadonly();

  /**
   * Shows a section in the AI Manager, without opening the tab.
   * @param section The section to show.
   */
  public show(section: AiManagerSection): void {
    this.sectionState.set(section);
    this.settings.set('aiManager.lastSection', section);
  }

  /**
   * Closes whichever section is shown, leaving the overview.
   */
  public collapse(): void {
    this.sectionState.set(null);
    this.settings.set('aiManager.lastSection', '');
  }

  /**
   * Opens the AI Manager tab at a section. If the tab is already open it is activated.
   * @param section The section to show.
   */
  public open(section: AiManagerSection): void {
    this.show(section);
    this.requested = true;
    this.tabs.open('model-manager');
    this.log.info('AiManagerNavigation', `Opened the AI Manager at '${section}'`);
  }

  /**
   * Starts a newly shown AI Manager where it was left, unless it was opened at a section on purpose.
   */
  public begin(): void {
    if (!this.requested) {
      const last: string = this.settings.get('aiManager.lastSection');
      this.sectionState.set(
        AI_MANAGER_SECTIONS.find((section: AiManagerSection): boolean => section === last) ?? null,
      );
    }
    this.requested = false;
  }
}
