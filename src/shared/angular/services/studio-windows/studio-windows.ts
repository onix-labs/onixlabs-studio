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
  WINDOW_FRAME,
  WINDOW_FRAME_CONFIG,
} from '@shared/angular/components/window-shell/window-frame-config';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import {
  AuxiliaryWindow,
  AuxiliaryWindows,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import { EditingChords } from '@shared/angular/services/editing-chords/editing-chords';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { Tab } from '@shared/angular/services/tabs/tab';
import { MAIN_WINDOW_ID, Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * Describes a Studio window other than the first.
 */
interface OpenWindow {
  /**
   * Gets the native window.
   */
  readonly window: AuxiliaryWindow;

  /**
   * Gets the frame rendering it.
   */
  readonly frame: ComponentRef<unknown>;
}

/**
 * Opens and tracks the Studio windows beyond the first (#1587). Each is a whole Studio surface — the
 * same frame the first window shows, bound to its own tabs — in a same-renderer child window, so its
 * tabs' state lives on through a move.
 *
 * Which window is in front follows the operating system's focus, so the ribbon, status strip, menu
 * and shortcuts act on the tab the user is working in. A window left with no tabs closes. Until
 * closing a window closes its tabs (step 5 of #1587), closing one brings its tabs back to the first
 * window, so nothing can be lost.
 */
@Service()
export class StudioWindows {
  /**
   * Holds the auxiliary-window opener.
   */
  private readonly aux: AuxiliaryWindows = inject(AuxiliaryWindows);

  /**
   * Holds the tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the root environment injector the frames are created under.
   */
  private readonly environmentInjector: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds the root injector.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the application, whose change detection the frames attach to.
   */
  private readonly applicationRef: ApplicationRef = inject(ApplicationRef);

  /**
   * Holds the keyboard router, which a window's key presses go to as the first window's do.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the application menu, whose chords a window's key presses reach as the first window's do.
   */
  private readonly menu: AppMenu = inject(AppMenu);

  /**
   * Holds the editing chords the application menu cannot carry.
   */
  private readonly editingChords: EditingChords = inject(EditingChords);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open windows, by window id.
   */
  private readonly windows: Map<string, OpenWindow> = new Map<string, OpenWindow>();

  /**
   * Holds the ids of the open windows, as a signal, so a window whose last tab leaves is seen to.
   */
  private readonly openIds: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds a counter for window ids.
   */
  private sequence: number = 0;

  /**
   * Holds the ids of the tabs moving between windows right now.
   */
  private readonly movingSignal: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the ids of the tabs moving between windows right now. A view torn down while its tab moves
   * is being re-created in another window, not closed, so it keeps what it owns (its document, its
   * shell); views bind their keep-alive inputs to this.
   */
  public readonly moving: Signal<ReadonlySet<string>> = this.movingSignal.asReadonly();

  /**
   * Initializes a new instance of the {@link StudioWindows} class: the first window coming to the
   * front makes it the window in front, and a window whose last tab leaves closes.
   */
  public constructor() {
    window.addEventListener('focus', (): void => this.tabs.focusWindow(MAIN_WINDOW_ID));
    effect((): void => {
      for (const windowId of this.openIds()) {
        if (this.tabs.tabsIn(windowId)().length === 0) {
          this.windows.get(windowId)?.window.close();
        }
      }
    });
  }

  /**
   * Moves a tab into a new Studio window of its own.
   * @param tabId The tab's identifier.
   */
  public openTabInNewWindow(tabId: string): void {
    const tab: Tab | undefined = this.tabs.get(tabId);
    if (tab === undefined) {
      return;
    }
    const window: AuxiliaryWindow | null = this.aux.open(tab.title, undefined, { bare: true });
    if (window === null) {
      return;
    }
    this.sequence += 1;
    const windowId: string = `window-${this.sequence}`;
    const document: Document = window.contentHost.ownerDocument;
    const frame: ComponentRef<unknown> = createComponent(this.injector.get(WINDOW_FRAME), {
      environmentInjector: this.environmentInjector,
      elementInjector: Injector.create({
        providers: [{ provide: WINDOW_FRAME_CONFIG, useValue: { windowId, document } }],
        parent: this.injector,
      }),
      hostElement: window.contentHost.appendChild(document.createElement('div')),
    });
    this.applicationRef.attachView(frame.hostView);

    // Keys and focus enter through the window's own document, as the first window's do through the
    // root shell.
    const view: Window | null = document.defaultView;
    view?.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (
        this.editingChords.handleSelectAll(event) ||
        this.keybindings.dispatch(event) ||
        this.menu.dispatchChord(event)
      ) {
        event.preventDefault();
      }
    });
    view?.addEventListener('focus', (): void => this.tabs.focusWindow(windowId));
    window.onClosed((): void => this.closed(windowId));

    this.move(tabId, windowId);
    // Only once its tab has arrived: until then it has none, and a window with none is closed.
    this.windows.set(windowId, { window, frame });
    this.openIds.set(new Set<string>([...this.openIds(), windowId]));
    this.log.info('StudioWindows', `Opened window ${windowId} for tab ${tabId}`);
  }

  /**
   * Moves a tab between windows, marking it as moving while its view is torn down in one and created
   * in the other, so the view keeps what it owns.
   * @param tabId The tab's identifier.
   * @param windowId The window it moves to.
   */
  private move(tabId: string, windowId: string): void {
    this.setMoving(tabId, true);
    // The views' keep-alive inputs take the new value before anything is torn down.
    this.applicationRef.tick();
    this.tabs.moveToWindow(tabId, windowId);
    this.tabs.focusWindow(windowId);
    this.applicationRef.tick();
    this.setMoving(tabId, false);
  }

  /**
   * Brings a closed window's tabs back to the first window, and lets the window go.
   * @param windowId The window's identifier.
   */
  private closed(windowId: string): void {
    const open: OpenWindow | undefined = this.windows.get(windowId);
    if (open === undefined) {
      return;
    }
    this.windows.delete(windowId);
    const ids: Set<string> = new Set<string>(this.openIds());
    ids.delete(windowId);
    this.openIds.set(ids);
    for (const tab of this.tabs.tabsIn(windowId)()) {
      this.move(tab.id, MAIN_WINDOW_ID);
    }
    this.applicationRef.detachView(open.frame.hostView);
    open.frame.destroy();
    this.tabs.forgetWindow(windowId);
    this.log.info('StudioWindows', `Closed window ${windowId}`);
  }

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
}
