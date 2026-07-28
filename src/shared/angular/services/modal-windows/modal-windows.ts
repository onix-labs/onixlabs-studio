import { inject, OnDestroy, Service } from '@angular/core';
import { MODAL_UNPARENTED_FEATURE, MODAL_WINDOW_URL } from '@shared/api/window-channels';
import { ChildWindowStyling } from '@shared/angular/services/child-window-styling/child-window-styling';

/**
 * Describes the window a modal asks for: how it is sized and chromed, and whether it hangs off the
 * window that raised it.
 */
export interface ModalWindowRequest {
  /**
   * Gets the window title. Modal windows carry no visible title bar, but the title still names the
   * window to the operating system (the window menu, the application switcher).
   */
  readonly title: string;

  /**
   * Gets the initial content width, in CSS pixels.
   */
  readonly width: number;

  /**
   * Gets the initial content height, in CSS pixels. The modal refines this once its content has
   * been measured.
   */
  readonly height: number;

  /**
   * Gets a value indicating whether the user may resize the window. Dialogs sized to their content
   * do not; the ones holding an editor or a whole surface do.
   */
  readonly resizable: boolean;

  /**
   * Gets a value indicating whether the user may close the window through its own chrome. A
   * blocking modal — one that may only be closed by an action its content provides — says false.
   */
  readonly closable: boolean;

  /**
   * Gets a value indicating whether the window hangs off the window that raised it. False opens a
   * free-standing window, which the welcome screen needs at a cold start: its opener is hidden, and
   * a child of a hidden window is not displayed at all on macOS.
   */
  readonly parented: boolean;

  /**
   * Gets the screen position of the window's top-left corner, or null to let the platform place it.
   */
  readonly position: ModalWindowPosition | null;
}

/**
 * Describes a screen position, in screen pixels.
 */
export interface ModalWindowPosition {
  /**
   * Gets the x coordinate.
   */
  readonly x: number;

  /**
   * Gets the y coordinate.
   */
  readonly y: number;
}

/**
 * One open modal window: the element its content renders into, and the operations the modal drives
 * it with while it lives.
 */
export interface ModalWindow {
  /**
   * Gets the element the modal's content renders into.
   */
  readonly contentHost: HTMLElement;

  /**
   * Gets the window's document, which the modal's window-scoped injector is built around.
   */
  readonly document: Document;

  /**
   * Gets the window itself, for measuring and for listening to its own events.
   */
  readonly view: Window;

  /**
   * Resizes the window so its content area matches the given size, and re-centres it over the
   * window that raised it. Called once the content has been measured, and whenever it changes size.
   * @param width The content width, in CSS pixels.
   * @param height The content height, in CSS pixels.
   */
  fit(width: number, height: number): void;

  /**
   * Brings the window to the front and gives it keyboard focus.
   */
  focus(): void;

  /**
   * Closes the window (the closed notification follows, exactly as for a user-initiated close).
   */
  close(): void;

  /**
   * Registers a listener invoked once when the window closes — by its own chrome, by {@link close},
   * or with the application.
   * @param listener The closed listener.
   */
  onClosed(listener: () => void): void;
}

/**
 * Holds the structural styles for a modal window's document. Everything else — colours, fonts,
 * component styles — comes from the application stylesheets mirrored into the child, so a modal
 * tracks the app's theme tokens exactly as the window that raised it does.
 *
 * The drag strip is the band the platform's window controls sit in: it makes the window movable
 * (there is no title bar to grab) and its height is the inset the panel leaves for the controls.
 */
const MODAL_STYLES: string = `
  html, body { block-size: 100%; }
  body { margin: 0; display: flex; flex-direction: column; overflow: hidden;
         background: var(--modal-panel-background, var(--modal-panel-background-color));
         color: var(--body-foreground-color); }
  .modal-window__drag { position: fixed; inset-block-start: 0; inset-inline: 0;
    block-size: var(--modal-window-drag-height); -webkit-app-region: drag; z-index: 10; }
  .modal-window__content { flex: 1; min-block-size: 0; display: flex; flex-direction: column;
    -webkit-app-region: no-drag; }
  .modal-window__content > * { flex: 1; min-block-size: 0; }
`;

/**
 * Holds the height, in CSS pixels, of the drag strip along a modal window's top edge — enough to
 * clear the platform's window controls, which are inset over the content.
 */
const DRAG_STRIP_HEIGHT: number = 44;

/**
 * Opens modal windows: same-renderer children opened on the modal sentinel URL, which the main
 * process gives dialog chrome and parents to the window that raised them.
 *
 * A modal window is the pop-out mechanism with a different intent — the opener builds the child's
 * DOM and renders Angular content into it, so the dialog keeps every service and signal of the
 * application it was raised from. The service owns the window itself: the request that opens it,
 * the styling mirror, the fit-to-content sizing, and the closed notification. What renders inside is
 * the modal's business.
 */
@Service()
export class ModalWindows implements OnDestroy {
  /**
   * Holds the styling mirror keeping open modal windows in step with this window.
   */
  private readonly styling: ChildWindowStyling = inject(ChildWindowStyling);

  /**
   * Holds the open modal windows.
   */
  private readonly children: Set<Window> = new Set<Window>();

  /**
   * Opens a modal window.
   * @param request The window the modal asks for.
   * @param owner The window raising the modal, which the new window centres over and parents to.
   * @returns Returns the window, or null when it could not be opened (no window environment, or the
   * platform refused) — the caller then falls back to presenting the modal in its own window.
   */
  public open(request: ModalWindowRequest, owner: Window): ModalWindow | null {
    const child: Window | null = owner.open(
      MODAL_WINDOW_URL,
      '_blank',
      this.features(request, owner),
    );
    if (child?.document == null) {
      return null;
    }

    const doc: Document = child.document;
    doc.title = request.title;
    this.styling.adopt(child);
    this.styling.appendStyles(doc, MODAL_STYLES);
    doc.documentElement.style.setProperty(
      '--modal-window-drag-height',
      `${DRAG_STRIP_HEIGHT / this.rootFontSize()}rem`,
    );

    const drag: HTMLElement = doc.createElement('div');
    drag.className = 'modal-window__drag';
    const contentHost: HTMLElement = doc.createElement('main');
    contentHost.className = 'modal-window__content';
    doc.body.appendChild(drag);
    doc.body.appendChild(contentHost);

    this.children.add(child);

    const closedListeners: (() => void)[] = [];
    let notified: boolean = false;
    const notifyClosed: () => void = (): void => {
      if (notified) {
        return;
      }
      notified = true;
      this.children.delete(child);
      this.styling.release(child);
      clearInterval(closePoll);
      for (const listener of closedListeners) {
        listener();
      }
    };
    child.addEventListener('pagehide', notifyClosed);
    // Belt for edge paths where pagehide is not delivered (e.g. an OS-forced close).
    const closePoll: ReturnType<typeof setInterval> = setInterval((): void => {
      if (child.closed) {
        notifyClosed();
      }
    }, 1000);

    return {
      contentHost,
      document: doc,
      view: child,
      fit: (width: number, height: number): void => this.fit(child, owner, width, height),
      focus: (): void => child.focus(),
      close: (): void => child.close(),
      onClosed: (listener: () => void): void => {
        closedListeners.push(listener);
      },
    };
  }

  /**
   * Builds the `window.open` features string for a request: the size and placement the main process
   * clamps against the displays, and the chrome flags it builds the window with.
   * @param request The window the modal asks for.
   * @param owner The window raising the modal.
   * @returns Returns the features string.
   */
  private features(request: ModalWindowRequest, owner: Window): string {
    const position: ModalWindowPosition =
      request.position ?? this.centredOver(owner, request.width, request.height);
    return [
      `width=${Math.round(request.width)}`,
      `height=${Math.round(request.height)}`,
      `left=${Math.round(position.x)}`,
      `top=${Math.round(position.y)}`,
      `resizable=${request.resizable ? 1 : 0}`,
      `closable=${request.closable ? 1 : 0}`,
      `${MODAL_UNPARENTED_FEATURE}=${request.parented ? 0 : 1}`,
    ].join(',');
  }

  /**
   * Resizes a modal window to hold the given content size and re-centres it over its owner. The
   * window's frame is measured rather than assumed, so the content lands at exactly the requested
   * size whatever chrome the platform draws around it.
   * @param child The modal window.
   * @param owner The window it was raised from.
   * @param width The content width, in CSS pixels.
   * @param height The content height, in CSS pixels.
   */
  private fit(child: Window, owner: Window, width: number, height: number): void {
    if (child.closed) {
      return;
    }
    const outerWidth: number = Math.round(width + (child.outerWidth - child.innerWidth));
    const outerHeight: number = Math.round(height + (child.outerHeight - child.innerHeight));
    const position: ModalWindowPosition = this.centredOver(owner, outerWidth, outerHeight);
    child.resizeTo(outerWidth, outerHeight);
    child.moveTo(Math.round(position.x), Math.round(position.y));
  }

  /**
   * Computes the screen position that centres a window of the given size over another — horizontally
   * centred, and a little above centre vertically, where a dialog reads as attached to what raised
   * it rather than floating in the middle of the screen.
   * @param owner The window to centre over.
   * @param width The window width.
   * @param height The window height.
   * @returns Returns the position of the centred window's top-left corner.
   */
  private centredOver(owner: Window, width: number, height: number): ModalWindowPosition {
    return {
      x: owner.screenX + (owner.outerWidth - width) / 2,
      y: owner.screenY + Math.max(0, (owner.outerHeight - height) / 3),
    };
  }

  /**
   * Reads the application's root font size, so pixel measurements can be expressed in the rem units
   * the styles are written in.
   * @returns Returns the root font size in pixels, falling back to the browser default.
   */
  private rootFontSize(): number {
    const size: number = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize || '16',
    );
    return Number.isFinite(size) && size > 0 ? size : 16;
  }

  /**
   * Closes every open modal window and stops mirroring into them.
   */
  public ngOnDestroy(): void {
    for (const child of this.children) {
      this.styling.release(child);
      child.close();
    }
    this.children.clear();
  }
}
