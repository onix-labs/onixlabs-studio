import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  Signal,
} from '@angular/core';
import { EditingChords } from '@shared/angular/services/editing-chords/editing-chords';
import { FeatureChrome, FeatureRegistry } from '@shared/angular/services/feature-registry';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { ScrollReveal } from '@shared/angular/services/scroll-reveal/scroll-reveal';
import { ShellPresence } from '@shared/angular/services/shell-presence/shell-presence';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WorkbenchAgentCapabilities } from '@shared/angular/services/workbench-agent-capabilities/workbench-agent-capabilities';
import { ContentHost } from '@shared/angular/components/content-host/content-host';
import { ModalBackdropView } from '@shared/angular/components/modal-backdrop/modal-backdrop-view';
import { AboutHost } from '@shared/angular/components/about-modal/about-host';
import { PluginConsentHost } from '@shared/angular/components/plugin-consent-modal/plugin-consent-host';
import { ToastHost } from '@shared/angular/components/toast-host/toast-host';
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
    ModalBackdropView,
    PluginConsentHost,
    AboutHost,
    WelcomeScreen,
    ConfigureDialogPanel,
    ToastHost,
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
   * Holds the editing chords the application menu cannot carry, which serve the focused text box.
   */
  private readonly editingChords: EditingChords = inject(EditingChords);

  /**
   * Holds the main window's presence, which hides the window while no tabs are open and the welcome
   * screen stands in for it. Injected for its effect; the shell never calls it.
   */
  private readonly presence: ShellPresence = inject(ShellPresence);

  /**
   * Holds the scrollbar reveal service, which flashes a container's custom scrollbar while it scrolls.
   * Injected for its effect; the shell never calls it.
   */
  private readonly scrollReveal: ScrollReveal = inject(ScrollReveal);

  /**
   * Holds the workbench agent capabilities, which let an agent on any surface open and populate a new
   * top-level tab. Injected for its effect; the shell never calls it.
   *
   * Registered here rather than by a view because the capabilities are application-global and must
   * resolve the *root* tab and document registries — a view-scoped injector would reach a workspace's
   * document well instead, and a view-scoped lifetime would take them away with the tab.
   */
  private readonly workbenchCapabilities: WorkbenchAgentCapabilities = inject(
    WorkbenchAgentCapabilities,
  );

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
  protected readonly activeChrome: Signal<FeatureChrome> = computed((): FeatureChrome =>
    this.registry.chromeFor(this.tabsService.activeTab()?.type),
  );

  /**
   * Routes a window-level key press to the active view's keyboard accelerators, suppressing the
   * browser default when one handles it. Listening at the window (bubble phase) lets an embedded
   * editor consume the keys it owns first — only chords it leaves unhandled reach the router.
   *
   * Select All is offered the event first, because it is not an accelerator any view registers: it
   * serves the focused text box, which the application menu cannot do without taking ⌘A from the
   * editors that bind it to their own selection model.
   *
   * @param event The keyboard event raised by the window.
   */
  @HostListener('window:keydown', ['$event'])
  protected onWindowKeydown(event: KeyboardEvent): void {
    if (this.editingChords.handleSelectAll(event) || this.keybindings.dispatch(event)) {
      event.preventDefault();
    }
  }
}
