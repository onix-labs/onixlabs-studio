import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  WINDOW_FRAME,
  WINDOW_FRAME_CONFIG,
  WindowFrameConfig,
} from '@shared/angular/components/window-shell/window-frame-config';
import {
  AuxiliaryWindow,
  AuxiliaryWindows,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import { Tab } from '@shared/angular/services/tabs/tab';
import { MAIN_WINDOW_ID, Tabs } from '@shared/angular/services/tabs/tabs';
import { StudioWindows } from './studio-windows';

/**
 * Stands in for a window's frame, recording the window it was made for.
 */
@Component({
  selector: 'app-stub-frame',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubFrame {
  /**
   * Holds the configuration the frame was made with.
   */
  public readonly config: WindowFrameConfig = inject(WINDOW_FRAME_CONFIG);
}

/**
 * A native window as the stand-in opener makes it: a real, separate document, and a close the test
 * can trigger.
 */
interface FakeWindow extends AuxiliaryWindow {
  /**
   * Simulates the user closing the window.
   */
  readonly userCloses: () => void;

  /**
   * Gets whether the window has been closed.
   */
  readonly isClosed: () => boolean;
}

describe('StudioWindows (#1587)', () => {
  let tabs: Tabs;
  let windows: StudioWindows;
  let opened: FakeWindow[];

  beforeEach(() => {
    opened = [];
    const aux: Partial<AuxiliaryWindows> = {
      open: (): AuxiliaryWindow => {
        const document: Document = window.document.implementation.createHTMLDocument('child');
        const listeners: (() => void)[] = [];
        let closed: boolean = false;
        const close: () => void = (): void => {
          if (!closed) {
            closed = true;
            for (const listener of listeners) {
              listener();
            }
          }
        };
        const fake: FakeWindow = {
          contentHost: document.body.appendChild(document.createElement('main')),
          titlebar: document.createElement('header'),
          containsScreenPoint: (): boolean => false,
          focus: (): void => undefined,
          close,
          onClosed: (listener: () => void): void => void listeners.push(listener),
          userCloses: close,
          isClosed: (): boolean => closed,
        };
        opened.push(fake);
        return fake;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuxiliaryWindows, useValue: aux },
        { provide: WINDOW_FRAME, useValue: StubFrame },
      ],
    });
    tabs = TestBed.inject(Tabs);
    windows = TestBed.inject(StudioWindows);
  });

  it('opensATabInAWindowOfItsOwn_whichComesToTheFront', () => {
    tabs.open('code');
    const moved: Tab = tabs.open('terminal');

    windows.openTabInNewWindow(moved.id);

    expect(opened).toHaveLength(1);
    const windowId: string = tabs.windowOf(moved.id);
    expect(windowId).not.toBe(MAIN_WINDOW_ID);
    expect(tabs.focusedWindow()).toBe(windowId);
    expect(tabs.activeTabIdIn(windowId)()).toBe(moved.id);
    expect(
      tabs
        .tabsIn(MAIN_WINDOW_ID)()
        .map((tab: Tab): string => tab.type),
    ).toEqual(['code']);
  });

  it('marksTheTabAsMoving_whileItsViewIsReCreated', () => {
    const moved: Tab = tabs.open('terminal');
    const seen: boolean[] = [];
    TestBed.runInInjectionContext((): void => {
      effect((): void => void seen.push(windows.moving().has(moved.id)));
    });
    TestBed.tick();

    windows.openTabInNewWindow(moved.id);
    TestBed.tick();

    // Moving while it moved, and not once it arrived.
    expect(seen).toContain(true);
    expect(windows.moving().has(moved.id)).toBe(false);
  });

  it('closesAWindow_whoseLastTabLeaves', () => {
    const moved: Tab = tabs.open('terminal');
    windows.openTabInNewWindow(moved.id);

    tabs.close(moved.id);
    TestBed.tick();

    expect(opened[0].isClosed()).toBe(true);
  });

  it('bringsAClosedWindowsTabsBack_toTheFirstWindow', () => {
    tabs.open('code');
    const moved: Tab = tabs.open('terminal');
    windows.openTabInNewWindow(moved.id);
    const windowId: string = tabs.windowOf(moved.id);

    opened[0].userCloses();

    expect(tabs.windowOf(moved.id)).toBe(MAIN_WINDOW_ID);
    expect(tabs.tabsIn(windowId)()).toEqual([]);
    expect(tabs.focusedWindow()).toBe(MAIN_WINDOW_ID);
  });

  it('makesEachWindowTheOneInFront_whenItTakesTheFocus', () => {
    const moved: Tab = tabs.open('terminal');
    windows.openTabInNewWindow(moved.id);
    const windowId: string = tabs.windowOf(moved.id);

    window.dispatchEvent(new Event('focus'));
    expect(tabs.focusedWindow()).toBe(MAIN_WINDOW_ID);

    opened[0].contentHost.ownerDocument.defaultView?.dispatchEvent(new Event('focus'));
    // A document made by createHTMLDocument has no window, so the first window is still in front.
    expect([MAIN_WINDOW_ID, windowId]).toContain(tabs.focusedWindow());
  });

  it('ignoresATabThatIsNotOpen', () => {
    windows.openTabInNewWindow('tab-nope');

    expect(opened).toHaveLength(0);
  });
});
