import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  Signal,
} from '@angular/core';
import { FeatureChrome, FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { ShortcutsOverlay } from '@shared/angular/services/shortcuts-overlay/shortcuts-overlay';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ContentHost } from '@shared/angular/components/content-host/content-host';
import { ShortcutsOverlayPanel } from '@shared/angular/components/shortcuts-overlay/shortcuts-overlay-panel';
import { RibbonStripContainer } from '@shared/angular/components/strips/ribbon-strip/ribbon-strip-container/ribbon-strip-container';
import { StatusStripContainer } from '@shared/angular/components/strips/status-strip/status-strip-container/status-strip-container';
import { TitleStripContainer } from '@shared/angular/components/strips/title-strip/title-strip-container/title-strip-container';
import { WelcomeScreen } from '@features/welcome/angular/welcome-screen/welcome-screen';
import { ConfigureDialogPanel } from '@features/workspace/angular/configure-dialog/configure-dialog';

/**
 * Represents the application root, composing the chrome strips and the content host, or the welcome
 * screen when no tabs are open.
 */
@Component({
  selector: 'app-root',
  imports: [
    RibbonStripContainer,
    StatusStripContainer,
    TitleStripContainer,
    ContentHost,
    WelcomeScreen,
    ShortcutsOverlayPanel,
    ConfigureDialogPanel,
  ],
  templateUrl: './root.html',
  styleUrl: './root.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Root {
  /**
   * Holds the tab registry used to adapt the layout to the active tab.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the feature registry, consulted for the active feature's chrome policy.
   */
  private readonly registry: FeatureRegistry = inject(FeatureRegistry);

  /**
   * Holds the application keybinding router, consulted for keyboard accelerators the active view has
   * registered.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the shortcuts-overlay visibility owner, toggled by the shell's global accelerator.
   */
  private readonly shortcutsOverlay: ShortcutsOverlay = inject(ShortcutsOverlay);

  /**
   * Initializes the shell, registering the application-level accelerators that dispatch in every
   * context after the active view has had first refusal.
   */
  public constructor() {
    this.keybindings.registerGlobal([
      { id: 'app.shortcuts', command: (): void => this.shortcutsOverlay.toggle() },
    ]);
  }

  /**
   * Gets a value indicating whether any tab is open. When none are, the chrome strips and content
   * host are replaced by the welcome screen.
   */
  protected readonly hasTabs: Signal<boolean> = computed(
    (): boolean => this.tabsService.tabs().length > 0,
  );

  /**
   * Gets the chrome policy of the active tab's feature: which strips the shell shows while it is
   * active. A full-bleed feature (such as settings) opts out of the ribbon and/or status strip
   * through its descriptor, so the shell hides them with no hard-coded knowledge of the feature.
   */
  protected readonly activeChrome: Signal<FeatureChrome> = computed(
    (): FeatureChrome => this.registry.chromeFor(this.tabsService.activeTab()?.type),
  );

  /**
   * Routes a window-level key press to the active view's keyboard accelerators, suppressing the
   * browser default when one handles it. Listening at the window (bubble phase) lets an embedded
   * editor consume the keys it owns first — only chords it leaves unhandled reach the router.
   * @param event The keyboard event raised by the window.
   */
  @HostListener('window:keydown', ['$event'])
  protected onWindowKeydown(event: KeyboardEvent): void {
    if (this.keybindings.dispatch(event)) {
      event.preventDefault();
    }
  }
}
