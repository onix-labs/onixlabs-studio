// TRIAL (#1593) — throwaway: moves a title-strip tab into a second same-renderer window and back.
import {
  ApplicationRef,
  ComponentRef,
  createComponent,
  effect,
  EnvironmentInjector,
  inject,
  Injector,
  Service,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import {
  TAB_WINDOW_CONFIG,
  TabWindowHost,
} from '@shared/angular/components/tab-window-host/tab-window-host';
import {
  AuxiliaryWindow,
  AuxiliaryWindows,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import { EditingChords } from '@shared/angular/services/editing-chords/editing-chords';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Describes a tab hosted in a window of its own.
 */
interface HostedTab {
  /**
   * Gets the window.
   */
  readonly window: AuxiliaryWindow;

  /**
   * Gets the host rendering the tab's view there.
   */
  readonly host: ComponentRef<TabWindowHost>;
}

/**
 * Moves title-strip tabs into windows of their own. A moved tab's view is destroyed in the main
 * window and created afresh in the new one, under the root injector and that window's document;
 * closing the window brings the tab back.
 */
@Service()
export class TabWindows {
  /**
   * Holds the auxiliary-window opener.
   */
  private readonly aux: AuxiliaryWindows = inject(AuxiliaryWindows);

  /**
   * Holds the tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the root environment injector the hosts are created under.
   */
  private readonly environmentInjector: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds the root injector.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the application, whose change detection the hosts attach to.
   */
  private readonly applicationRef: ApplicationRef = inject(ApplicationRef);

  /**
   * Holds the keyboard router the windows forward their key presses to.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the editing chords the application menu cannot carry.
   */
  private readonly editingChords: EditingChords = inject(EditingChords);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds each hosted tab, by tab id.
   */
  private readonly hosted: Map<string, HostedTab> = new Map<string, HostedTab>();

  /**
   * Holds the ids of the tabs hosted elsewhere, which the main window does not render.
   */
  private readonly elsewhereSignal: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Gets the ids of the tabs hosted in windows of their own.
   */
  public readonly elsewhere: Signal<ReadonlySet<string>> = this.elsewhereSignal.asReadonly();

  /**
   * Holds the ids of the tabs being moved between windows right now: a view destroyed while its tab
   * is moving is being re-parented, not closed, and keeps what it owns alive (its document, its PTY).
   */
  private readonly movingSignal: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the ids of the tabs moving between windows right now. Views bind their keep-alive inputs to
   * it, and are only torn down once those inputs have been updated.
   */
  public readonly moving: Signal<ReadonlySet<string>> = this.movingSignal.asReadonly();

  /**
   * Marks a tab as moving, or not.
   * @param tabId The tab's identifier.
   * @param moving Whether it is moving.
   */
  private setMoving(tabId: string, moving: boolean): void {
    const next: Set<string> = new Set<string>(this.moving());
    if (moving) {
      next.add(tabId);
    } else {
      next.delete(tabId);
    }
    this.movingSignal.set(next);
  }

  /**
   * Initializes a new instance of the {@link TabWindows} class, closing a hosted tab's window when
   * the tab itself closes.
   */
  public constructor() {
    effect((): void => {
      const open: ReadonlySet<string> = new Set<string>(
        this.tabs.tabs().map((tab: Tab): string => tab.id),
      );
      for (const [tabId, hosted] of [...this.hosted]) {
        if (!open.has(tabId)) {
          hosted.window.close();
        }
      }
    });
  }

  /**
   * Moves a tab into a new window of its own.
   * @param tabId The tab's identifier.
   */
  public openInNewWindow(tabId: string): void {
    const tab: Tab | undefined = this.tabs.get(tabId);
    const existing: HostedTab | undefined = this.hosted.get(tabId);
    if (tab === undefined || existing !== undefined) {
      existing?.window.focus();
      return;
    }
    const window: AuxiliaryWindow | null = this.aux.open(tab.title);
    if (window === null) {
      return;
    }
    const document: Document = window.contentHost.ownerDocument;
    // The main window lets go of the view first, so the tab is never mounted twice; it is marked as
    // moving while it does, so the view keeps what it owns.
    this.setMoving(tabId, true);
    this.applicationRef.tick();
    this.elsewhereSignal.set(new Set<string>([...this.elsewhere(), tabId]));
    this.applicationRef.tick();
    const host: ComponentRef<TabWindowHost> = createComponent(TabWindowHost, {
      environmentInjector: this.environmentInjector,
      elementInjector: Injector.create({
        providers: [{ provide: TAB_WINDOW_CONFIG, useValue: { document, tabId } }],
        parent: this.injector,
      }),
      hostElement: window.contentHost.appendChild(document.createElement('div')),
    });
    this.applicationRef.attachView(host.hostView);
    this.applicationRef.tick();
    this.setMoving(tabId, false);
    this.hosted.set(tabId, { window, host });
    document.defaultView?.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (this.editingChords.handleSelectAll(event) || this.keybindings.dispatch(event, tabId)) {
        event.preventDefault();
      }
    });
    window.onClosed((): void => this.bringBack(tabId));
    this.log.info('TabWindows', `Moved tab ${tabId} into a window of its own`);
  }

  /**
   * Brings a tab back into the main window when its window closes.
   * @param tabId The tab's identifier.
   */
  private bringBack(tabId: string): void {
    const hosted: HostedTab | undefined = this.hosted.get(tabId);
    if (hosted === undefined) {
      return;
    }
    this.hosted.delete(tabId);
    // Coming back is a move too, unless the tab itself has closed.
    const alive: boolean = this.tabs.get(tabId) !== undefined;
    if (alive) {
      this.setMoving(tabId, true);
      this.applicationRef.tick();
    }
    this.applicationRef.detachView(hosted.host.hostView);
    hosted.host.destroy();
    const elsewhere: Set<string> = new Set<string>(this.elsewhere());
    elsewhere.delete(tabId);
    this.elsewhereSignal.set(elsewhere);
    this.applicationRef.tick();
    this.setMoving(tabId, false);
    this.log.info('TabWindows', `Brought tab ${tabId} back into the main window`);
  }
}
