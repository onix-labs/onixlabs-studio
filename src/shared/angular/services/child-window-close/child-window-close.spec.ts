import { watchChildWindowClosed } from './child-window-close';

/**
 * A stand-in for a child window: it can raise `pagehide` without having closed (which is what the
 * initial `about:blank` load does), and can be closed for real.
 */
class FakeChildWindow {
  public closed: boolean = false;
  private readonly listeners: Map<string, (() => void)[]> = new Map<string, (() => void)[]>();

  public addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  public removeEventListener(type: string, listener: () => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry: () => void): boolean => entry !== listener),
    );
  }

  public raisePageHide(): void {
    for (const listener of this.listeners.get('pagehide') ?? []) {
      listener();
    }
  }

  public close(): void {
    this.closed = true;
    this.raisePageHide();
  }
}

describe('watchChildWindowClosed', () => {
  let child: FakeChildWindow;
  let closed: number;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    child = new FakeChildWindow();
    closed = 0;
    stop = watchChildWindowClosed(child as unknown as Window, (): void => {
      closed += 1;
    });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('whenPageHideFiresWithoutClosing_doesNotReportAClose', () => {
    child.raisePageHide();
    vi.advanceTimersByTime(100);

    expect(closed).toBe(0);
  });

  it('whenTheWindowCloses_reportsItOnce', () => {
    child.close();
    vi.advanceTimersByTime(1000);

    expect(closed).toBe(1);
  });

  it('whenTheWindowClosesWithoutPageHide_theBeltStillReportsIt', () => {
    child.closed = true;
    vi.advanceTimersByTime(1000);

    expect(closed).toBe(1);
  });

  it('afterStopping_reportsNothing', () => {
    stop();
    child.close();
    vi.advanceTimersByTime(1000);

    expect(closed).toBe(0);
  });
});
