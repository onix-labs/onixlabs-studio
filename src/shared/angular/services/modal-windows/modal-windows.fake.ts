import { ModalWindow, ModalWindowRequest } from './modal-windows';

/**
 * A stand-in for {@link ModalWindows} for tests. The real opener asks the platform for an operating-
 * system window, which a headless test cannot grant; this double records what was asked for and
 * renders the modal's content into a detached-but-attached element in the test document, so a spec
 * can drive the window path exactly as the app takes it — every modal is window-presented, there is
 * no inline fallback to lean on.
 *
 * The content host is appended to the document body (not left detached) so the modal's content is
 * live and queryable, and its change detection — the host view is attached to the ApplicationRef —
 * is flushed by `await fixture.whenStable()` the same as the fixture's own.
 */
export class FakeModalWindows {
  /**
   * Holds the requests passed to {@link open}, in order, so a spec can assert what a modal asked its
   * window for.
   */
  public readonly requests: ModalWindowRequest[] = [];

  /**
   * Holds the content sizes the modal fitted its window to.
   */
  public readonly fitted: { width: number; height: number }[] = [];

  /**
   * Holds the content host of the most recently opened window — where that modal's content renders.
   */
  public contentHost: HTMLElement | null = null;

  /**
   * Holds the number of windows opened over this double's life.
   */
  public openCount: number = 0;

  /**
   * Holds the number of windows closed over this double's life.
   */
  public closed: number = 0;

  /**
   * Holds a value indicating whether the next {@link open} refuses — returning null as the platform
   * would when it cannot grant a window, so a spec can exercise the modal's open-failure path.
   */
  public refuseOpen: boolean = false;

  /**
   * Holds the closer of the most recently opened window, so {@link notifyClosed} can stand in for the
   * user closing it through its own chrome.
   */
  private lastClose: (() => void) | null = null;

  /**
   * Gets the number of windows currently open — opened less closed.
   */
  public get openWindows(): number {
    return this.openCount - this.closed;
  }

  /**
   * Opens a fake modal window, or refuses when {@link refuseOpen} is set.
   * @param request The window the modal asks for.
   * @returns Returns the window, or null when refused.
   */
  public open(request: ModalWindowRequest): ModalWindow | null {
    this.requests.push(request);
    if (this.refuseOpen) {
      return null;
    }
    this.openCount += 1;
    const contentHost: HTMLElement = document.createElement('div');
    document.body.appendChild(contentHost);
    this.contentHost = contentHost;

    const listeners: (() => void)[] = [];
    let isClosed: boolean = false;
    const doClose: () => void = (): void => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      this.closed += 1;
      contentHost.remove();
      for (const listener of listeners) {
        listener();
      }
    };
    this.lastClose = doClose;

    return {
      contentHost,
      document,
      view: window,
      fit: (width: number, height: number): void => {
        this.fitted.push({ width, height });
      },
      focus: (): void => undefined,
      close: (): void => doClose(),
      onClosed: (listener: () => void): void => {
        listeners.push(listener);
      },
    };
  }

  /**
   * Stands in for the user closing the most recently opened window through its own chrome.
   */
  public notifyClosed(): void {
    this.lastClose?.();
  }
}
