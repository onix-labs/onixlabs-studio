import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SetupWizard } from '@shared/angular/services/setup-wizard/setup-wizard';
import { Studio } from '@shared/angular/services/studio/studio';
import { TabType } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { WelcomeCreate } from '@features/welcome/angular/welcome-create/welcome-create';
import { WelcomeGetStarted } from '@features/welcome/angular/welcome-get-started/welcome-get-started';
import { WelcomeSourceControl } from '@features/welcome/angular/welcome-source-control/welcome-source-control';
import { WelcomeTools } from '@features/welcome/angular/welcome-tools/welcome-tools';

/**
 * Names the welcome screen's sections.
 */
export type WelcomeSection = 'get-started' | 'create' | 'source-control' | 'tools';

/**
 * Describes one of the section tabs.
 */
interface SectionTab {
  /**
   * Gets the section.
   */
  readonly id: WelcomeSection;

  /**
   * Gets the tab's label.
   */
  readonly label: string;

  /**
   * Gets the tab's icon.
   */
  readonly icon: Icon;

  /**
   * Gets a value indicating whether the section is shown. A section still being built is kept, whole
   * and tested, but left out of the tab strip until there is something real behind it.
   */
  readonly shown: boolean;
}

/**
 * Represents the welcome screen: the front door to Studio, which gets the user from a cold start into
 * a tab.
 *
 * It is presented in its own window by the reusable {@link Modal}, in one of two roles. With no tabs
 * open it IS the application: the main window is hidden, the welcome window stands free of it with no
 * backdrop, and closing that window closes the application. Summoned from the title strip's new-tab
 * button it is an ordinary modal over a blurred main window, dismissed back to the tabs behind it.
 *
 * Beneath the identity, four sections share one tab strip drawn like the document tabs, each a way of
 * using Studio: Get Started ("I know what I want to work on"), Create Something ("help me design and
 * build something"), Source Control ("bring existing code in") and Tools ("manage the environment").
 * The sections report what the user did; this screen decides when to step aside.
 */
@Component({
  selector: 'app-welcome-screen',
  imports: [
    AppIcon,
    Modal,
    ModalContent,
    WelcomeGetStarted,
    WelcomeCreate,
    WelcomeSourceControl,
    WelcomeTools,
  ],
  templateUrl: './welcome-screen.html',
  styleUrl: './welcome-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeScreen {
  /**
   * Gets the section tabs, in order.
   */
  protected readonly sections: readonly SectionTab[] = [
    { id: 'get-started', label: 'Get Started', icon: Icon.WELCOME_GET_STARTED, shown: true },
    // ⚠️ Hidden, not removed: Create Something has no project generator behind it yet, and Source
    // Control has no version-control or hosting plugins. Each is designed and tested, and shows again
    // when its own branch makes it real.
    { id: 'create', label: 'Create Something', icon: Icon.WELCOME_PROJECT, shown: false },
    {
      id: 'source-control',
      label: 'Source Control',
      icon: Icon.WELCOME_SOURCE_CONTROL,
      shown: false,
    },
    { id: 'tools', label: 'Tools & Settings', icon: Icon.WELCOME_TOOLS, shown: true },
  ];

  /**
   * Gets the sections in the tab strip.
   */
  protected readonly shownSections: readonly SectionTab[] = this.sections.filter(
    (tab: SectionTab): boolean => tab.shown,
  );

  /**
   * Holds the tab registry the welcome actions open into.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the welcome modal state, dismissed once an action routes the user into a tab.
   */
  private readonly welcomeModal: WelcomeModal = inject(WelcomeModal);

  /**
   * Holds the setup wizard, which precedes this screen on a first launch and after a version change.
   */
  private readonly setupWizard: SetupWizard = inject(SetupWizard);

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
   *
   * The setup wizard takes precedence over all of it. Both want the same cold start, and both present
   * a freestanding window over a hidden main window, so showing them together would race two windows
   * for one launch. Setup comes first, and this reappears the moment it finishes.
   */
  protected readonly visible: Signal<boolean> = computed(
    (): boolean =>
      !this.setupWizard.isOpen() &&
      !this.dismissed() &&
      (this.tabsService.tabs().length === 0 || this.welcomeModal.isOpen()),
  );

  /**
   * Holds the section shown. Every showing starts on Get Started — the screen is a front door, and the
   * door opens onto the same room each time — so it resets whenever the screen is shown again.
   */
  protected readonly section: WritableSignal<WelcomeSection> = linkedSignal<
    boolean,
    WelcomeSection
  >({
    source: (): boolean => this.visible(),
    computation: (): WelcomeSection => 'get-started',
  });

  /**
   * Gets a value indicating whether the welcome screen is standing in for the application rather
   * than being summoned over it: no tabs are open, so the main window is hidden and the welcome
   * window stands free of it.
   */
  protected readonly standsAlone: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length === 0,
  );

  /**
   * Determines whether a section is shown.
   * @param section The section.
   * @returns Returns true when it is in the tab strip.
   */
  protected isShown(section: WelcomeSection): boolean {
    return this.shownSections.some((tab: SectionTab): boolean => tab.id === section);
  }

  /**
   * Shows a section.
   * @param section The section.
   */
  protected show(section: WelcomeSection): void {
    this.log.debug('welcome', `Section "${section}" shown`);
    this.section.set(section);
  }

  /**
   * Moves between the section tabs with the arrow, Home and End keys, as a tab list does.
   * @param event The keyboard event.
   * @param index The index of the tab the key was pressed on.
   */
  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    const last: number = this.shownSections.length - 1;
    const target: number | null = ((): number | null => {
      switch (event.key) {
        case 'ArrowRight':
          return index === last ? 0 : index + 1;
        case 'ArrowLeft':
          return index === 0 ? last : index - 1;
        case 'Home':
          return 0;
        case 'End':
          return last;
        default:
          return null;
      }
    })();
    if (target === null) {
      return;
    }
    event.preventDefault();
    this.show(this.shownSections[target].id);
    const strip: Element | null = (event.currentTarget as HTMLElement).parentElement;
    strip?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
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
   * Steps aside after a section opened something itself (a file, a folder, a recent item).
   */
  protected opened(): void {
    this.dismissed.set(true);
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
      this.log.debug('welcome', 'Welcome screen dismissed to tabs');
      this.welcomeModal.close();
    } else {
      this.log.info('welcome', 'Welcome window closed; closing application');
      this.studio.closeWindow();
    }
  }
}
