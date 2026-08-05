import { TestBed } from '@angular/core/testing';
import { MODAL_UNPARENTED_FEATURE, MODAL_WINDOW_URL } from '@shared/api/window-channels';

import { ModalWindow, ModalWindowRequest, ModalWindows } from './modal-windows';

/**
 * A stand-in for the child window a modal opens: a real (detached) document the service can build
 * its chrome in, plus the operations it drives the window with.
 */
class FakeChildWindow {
  public readonly document: Document = document.implementation.createHTMLDocument('modal');
  public closed: boolean = false;
  public readonly resized: { width: number; height: number }[] = [];
  public readonly moved: { x: number; y: number }[] = [];
  public focused: number = 0;
  public innerWidth: number = 400;
  public innerHeight: number = 300;
  public outerWidth: number = 400;
  public outerHeight: number = 300;

  public addEventListener(): void {
    // The service only listens for the window closing, which this fake drives directly.
  }

  public removeEventListener(): void {
    // Paired with addEventListener above.
  }

  public focus(): void {
    this.focused += 1;
  }

  public close(): void {
    this.closed = true;
  }

  public resizeTo(width: number, height: number): void {
    this.resized.push({ width, height });
  }

  public moveTo(x: number, y: number): void {
    this.moved.push({ x, y });
  }
}

/**
 * A stand-in for the window a modal is raised from: it records what the modal asked for and hands
 * back the child.
 */
class FakeOwnerWindow {
  public readonly child: FakeChildWindow = new FakeChildWindow();
  public url: string | null = null;
  public features: string | null = null;
  public readonly screen: { availWidth: number; availHeight: number; availLeft: number } = {
    availWidth: 1600,
    availHeight: 1000,
    availLeft: 0,
  };
  public screenX: number = 200;
  public screenY: number = 100;
  public outerWidth: number = 1200;
  public outerHeight: number = 800;
  public innerWidth: number = 1200;
  public innerHeight: number = 800;

  public open(url: string, _target: string, features: string): FakeChildWindow {
    this.url = url;
    this.features = features;
    return this.child;
  }
}

/**
 * Reads a numeric entry out of a features string.
 * @param features The features string.
 * @param name The entry name.
 * @returns Returns the value, or null when absent.
 */
function feature(features: string, name: string): number | null {
  const match: RegExpExecArray | null = new RegExp(`(?:^|,)${name}=([^,]+)`).exec(features);
  return match === null ? null : Number(match[1]);
}

describe('ModalWindows', () => {
  let windows: ModalWindows;
  let owner: FakeOwnerWindow;

  const REQUEST: ModalWindowRequest = {
    title: 'Rename conversation',
    width: 416,
    height: 280,
    resizable: false,
    closable: true,
    parented: true,
    position: null,
    minimum: null,
    maximum: null,
    background: null,
  };

  /**
   * Opens a modal window with the given request over the fake owner.
   * @param request The parts of the request to override.
   * @returns Returns the opened window.
   */
  function open(request: Partial<ModalWindowRequest> = {}): ModalWindow | null {
    return windows.open({ ...REQUEST, ...request }, owner as unknown as Window);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    windows = TestBed.inject(ModalWindows);
    owner = new FakeOwnerWindow();
  });

  it('should create', () => {
    expect(windows).toBeTruthy();
  });

  it('open_usesTheModalSentinelUrl_soTheGuardsAllowItAsAModal', () => {
    open();

    expect(owner.url).toBe(MODAL_WINDOW_URL);
  });

  it('open_titlesTheWindow_andBuildsItsContentHost', () => {
    const modal: ModalWindow | null = open();

    expect(modal).not.toBeNull();
    expect(owner.child.document.title).toBe('Rename conversation');
    expect(modal!.contentHost.className).toContain('modal-window__content');
    expect(owner.child.document.querySelector('.modal-window__drag')).not.toBeNull();
    expect(owner.child.document.body.style.getPropertyValue('--modal-window-drag-height')).not.toBe(
      '0rem',
    );
  });

  it('open_whenDragless_omitsTheDragStripAndReservesNoInset', () => {
    const modal: ModalWindow | null = open({ dragless: true });

    expect(modal).not.toBeNull();
    // No drag strip is rendered, and the panel's top inset (keyed off the drag height) collapses so
    // the content sits flush to the top — the welcome screen's chromeless presentation.
    expect(owner.child.document.querySelector('.modal-window__drag')).toBeNull();
    expect(owner.child.document.body.style.getPropertyValue('--modal-window-drag-height')).toBe(
      '0rem',
    );
    // The content host is still built, so the modal renders exactly as usual otherwise.
    expect(modal!.contentHost.className).toContain('modal-window__content');
  });

  it('features_carryTheRequestedSizeAndChrome', () => {
    open({ resizable: true, closable: false });

    const features: string = owner.features!;
    expect(feature(features, 'width')).toBe(416);
    expect(feature(features, 'height')).toBe(280);
    expect(feature(features, 'resizable')).toBe(1);
    expect(feature(features, 'closable')).toBe(0);
  });

  it('features_carryTheResizeBounds_onlyWhenStated', () => {
    open();
    expect(owner.features).not.toContain('minwidth');
    expect(owner.features).not.toContain('maxwidth');

    open({ minimum: { width: 960, height: 600 }, maximum: { width: 1024, height: 720 } });

    const features: string = owner.features!;
    expect(feature(features, 'minwidth')).toBe(960);
    expect(feature(features, 'minheight')).toBe(600);
    expect(feature(features, 'maxwidth')).toBe(1024);
    expect(feature(features, 'maxheight')).toBe(720);
  });

  it('features_carryTheOpeningColour_withoutItsHash', () => {
    open({ background: '#1e2124' });

    expect(owner.features).toContain('bgcolor=1e2124');
  });

  it('features_markAFreeStandingModalAsUnparented', () => {
    open({ parented: true });
    expect(feature(owner.features!, MODAL_UNPARENTED_FEATURE)).toBe(0);

    open({ parented: false });
    expect(feature(owner.features!, MODAL_UNPARENTED_FEATURE)).toBe(1);
  });

  it('position_whenParented_centresOverTheRaisingWindow', () => {
    open();

    // Horizontally centred over the owner, and a little above its centre vertically.
    expect(feature(owner.features!, 'left')).toBe(200 + (1200 - 416) / 2);
    expect(feature(owner.features!, 'top')).toBe(100 + Math.round((800 - 280) / 3));
  });

  it('position_whenFreeStanding_centresOnTheDisplay', () => {
    open({ parented: false });

    expect(feature(owner.features!, 'left')).toBe((1600 - 416) / 2);
    expect(feature(owner.features!, 'top')).toBe((1000 - 280) / 2);
  });

  it('position_whenTheOpenerPlacedIt_isHonouredAsIs', () => {
    open({ position: { x: 42, y: 84 } });

    expect(feature(owner.features!, 'left')).toBe(42);
    expect(feature(owner.features!, 'top')).toBe(84);
  });

  it('fit_resizesToTheContentSizePlusTheWindowsChrome_andRecentres', () => {
    const modal: ModalWindow | null = open();
    owner.child.outerHeight = 320;
    owner.child.innerHeight = 300;

    modal!.fit(500, 400);

    // The frame is measured rather than assumed: 20px of chrome here.
    expect(owner.child.resized).toEqual([{ width: 500, height: 420 }]);
    expect(owner.child.moved.length).toBe(1);
  });

  it('fit_whenTheWindowIsPartWayThroughAResize_keepsTheChromeItFirstMeasured', () => {
    const modal: ModalWindow | null = open();
    owner.child.outerHeight = 320;
    owner.child.innerHeight = 300;
    modal!.fit(500, 400);

    // A resize lands on the outer size before the inner one catches up. Read afresh at that moment,
    // the frame comes out NEGATIVE — and the window would be resized smaller than its content.
    owner.child.outerHeight = 420;
    modal!.fit(500, 400);

    expect(owner.child.resized).toEqual([
      { width: 500, height: 420 },
      { width: 500, height: 420 },
    ]);
  });

  it('fit_whenTheChromeReadsAsNonsense_assumesNone_andMeasuresAgainNextTime', () => {
    const modal: ModalWindow | null = open();
    owner.child.outerHeight = 100;
    owner.child.innerHeight = 300;

    modal!.fit(500, 400);
    expect(owner.child.resized).toEqual([{ width: 500, height: 400 }]);

    owner.child.outerHeight = 320;
    owner.child.innerHeight = 300;
    modal!.fit(500, 400);

    expect(owner.child.resized[1]).toEqual({ width: 500, height: 420 });
  });

  it('fit_whenTheWindowHasClosed_doesNothing', () => {
    const modal: ModalWindow | null = open();
    owner.child.closed = true;

    modal!.fit(500, 400);

    expect(owner.child.resized).toEqual([]);
  });

  it('close_closesTheWindow', () => {
    const modal: ModalWindow | null = open();

    modal!.close();

    expect(owner.child.closed).toBe(true);
  });

  it('ngOnDestroy_closesEveryOpenModalWindow', () => {
    open();

    windows.ngOnDestroy();

    expect(owner.child.closed).toBe(true);
  });
});
