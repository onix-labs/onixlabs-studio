import { inject, OnDestroy, Service } from '@angular/core';
import { MODAL_UNPARENTED_FEATURE, MODAL_WINDOW_URL } from '@shared/api/window-channels';
import { watchChildWindowClosed } from '@shared/angular/services/child-window-close/child-window-close';
import { ChildWindowStyling } from '@shared/angular/services/child-window-styling/child-window-styling';
import { Log } from '@shared/angular/services/log/log';

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
   * Gets the smallest the user may make the window, in CSS pixels, or null for the modal default.
   */
  readonly minimum: ModalWindowSize | null;

  /**
   * Gets the largest the user may make the window, in CSS pixels, or null for no ceiling.
   */
  readonly maximum: ModalWindowSize | null;

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
   * Gets the screen position of the window's top-left corner, or null to centre the window.
   */
  readonly position: ModalWindowPosition | null;

  /**
   * Gets the colour the window paints while its content is on its way, as a `#rrggbb` triplet, or
   * null to leave it to the platform. It is the colour the modal's panel will land on, so the
   * window never flashes a colour its content does not have.
   */
  readonly background: string | null;

  /**
   * Gets a value indicating whether the window omits its top drag strip and the inset that reserves
   * room for it. Content that supplies its own top spacing and does not need the window movable by a
   * top band (the welcome screen) says true, and its content then sits flush to the top edge. Left
   * false, the window carries the drag strip so it can be moved and its controls do not overlap the
   * content.
   */
  readonly dragless?: boolean;
}

/**
 * Describes a window size, in CSS pixels.
 */
export interface ModalWindowSize {
  /**
   * Gets the width.
   */
  readonly width: number;

  /**
   * Gets the height.
   */
  readonly height: number;
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
 * Holds the largest chrome, in CSS pixels, a modal window is believed to draw around its content in
 * either direction. A measurement beyond this is not chrome but a window part-way through a resize,
 * and is discarded.
 */
const MAX_FRAME: number = 200;

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the open modal windows.
   */
  private readonly children: Set<Window> = new Set<Window>();

  /**
   * Holds the chrome each modal window draws around its content, measured once per window.
   */
  private readonly frames: WeakMap<Window, ModalWindowSize> = new WeakMap<
    Window,
    ModalWindowSize
  >();

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
      this.log.warn('ModalWindows', `Failed to open modal window '${request.title}'`);
      return null;
    }

    const doc: Document = child.document;
    doc.title = request.title;
    this.styling.adopt(child);
    this.styling.appendStyles(doc, MODAL_STYLES);
    // Set on the body, not the root: the root's `style` attribute is mirrored from the opener by
    // the styling service, which would wipe anything written there. A dragless window reserves no
    // inset, so the panel's `padding-block-start: max(panel-padding, drag-height)` falls back to the
    // plain panel padding and its content sits flush to the top.
    doc.body.style.setProperty(
      '--modal-window-drag-height',
      request.dragless ? '0rem' : `${DRAG_STRIP_HEIGHT / this.rootFontSize()}rem`,
    );

    // The drag strip is both the band that moves the frameless window and the inset its controls sit
    // in; a dragless window wants neither, so it is left out entirely rather than rendered at zero
    // height.
    if (!request.dragless) {
      const drag: HTMLElement = doc.createElement('div');
      drag.className = 'modal-window__drag';
      doc.body.appendChild(drag);
    }
    const contentHost: HTMLElement = doc.createElement('main');
    contentHost.className = 'modal-window__content';
    doc.body.appendChild(contentHost);

    this.children.add(child);
    this.log.info('ModalWindows', `Opened modal window '${request.title}'`);

    const closedListeners: (() => void)[] = [];
    watchChildWindowClosed(child, (): void => {
      this.children.delete(child);
      this.styling.release(child);
      this.log.info('ModalWindows', `Closed modal window '${request.title}'`);
      for (const listener of closedListeners) {
        listener();
      }
    });

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
      request.position ?? this.centred(request, owner, request.width, request.height);
    return [
      `width=${Math.round(request.width)}`,
      `height=${Math.round(request.height)}`,
      `left=${Math.round(position.x)}`,
      `top=${Math.round(position.y)}`,
      `resizable=${request.resizable ? 1 : 0}`,
      `closable=${request.closable ? 1 : 0}`,
      `${MODAL_UNPARENTED_FEATURE}=${request.parented ? 0 : 1}`,
      ...(request.background === null ? [] : [`bgcolor=${request.background.replace('#', '')}`]),
      ...(request.minimum === null
        ? []
        : [
            `minwidth=${Math.round(request.minimum.width)}`,
            `minheight=${Math.round(request.minimum.height)}`,
          ]),
      ...(request.maximum === null
        ? []
        : [
            `maxwidth=${Math.round(request.maximum.width)}`,
            `maxheight=${Math.round(request.maximum.height)}`,
          ]),
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
    const frame: ModalWindowSize = this.frame(child);
    const outerWidth: number = Math.round(width + frame.width);
    const outerHeight: number = Math.round(height + frame.height);
    const position: ModalWindowPosition = this.centredOver(owner, outerWidth, outerHeight);
    child.resizeTo(outerWidth, outerHeight);
    child.moveTo(Math.round(position.x), Math.round(position.y));
  }

  /**
   * Reads the chrome a modal window draws around its content, measuring it once and remembering it.
   *
   * It cannot be read afresh on every fit: a window part-way through a resize reports its new outer
   * size against its old inner one, so the difference is not chrome at all — it can even be negative,
   * and a modal refitted at that moment (the content observer firing on the frame its own resize
   * lands) would shrink by it. The chrome does not change over a window's life, so the first sane
   * reading stands; an unusable one is treated as none and re-read next time.
   * @param child The modal window.
   * @returns Returns the chrome width and height, in CSS pixels.
   */
  private frame(child: Window): ModalWindowSize {
    const known: ModalWindowSize | undefined = this.frames.get(child);
    if (known !== undefined) {
      return known;
    }
    const measured: ModalWindowSize = {
      width: child.outerWidth - child.innerWidth,
      height: child.outerHeight - child.innerHeight,
    };
    const sane: boolean = [measured.width, measured.height].every(
      (value: number): boolean => value >= 0 && value <= MAX_FRAME,
    );
    if (!sane) {
      return { width: 0, height: 0 };
    }
    this.frames.set(child, measured);
    return measured;
  }

  /**
   * Computes where a modal window opens: centred over the window it was raised from, or centred on
   * the display when it stands free — a free-standing modal has no window behind it to be attached
   * to, and its opener is hidden and may be anywhere.
   * @param request The window the modal asks for.
   * @param owner The window the modal is raised from.
   * @param width The window width.
   * @param height The window height.
   * @returns Returns the position of the window's top-left corner.
   */
  private centred(
    request: ModalWindowRequest,
    owner: Window,
    width: number,
    height: number,
  ): ModalWindowPosition {
    return request.parented
      ? this.centredOver(owner, width, height)
      : this.centredOnScreen(owner, width, height);
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
   * Computes the screen position that centres a window of the given size on the display's usable
   * area (excluding the menu bar and dock).
   * @param owner The window whose display is used.
   * @param width The window width.
   * @param height The window height.
   * @returns Returns the position of the centred window's top-left corner.
   */
  private centredOnScreen(owner: Window, width: number, height: number): ModalWindowPosition {
    // availLeft/availTop are only in the (widely implemented) Window Management additions to
    // Screen, so they are read defensively; a display whose usable area starts at the origin is
    // the common case anyway.
    const screen: Screen & { availLeft?: number; availTop?: number } = owner.screen;
    return {
      x: (screen.availLeft ?? 0) + (screen.availWidth - width) / 2,
      y: (screen.availTop ?? 0) + (screen.availHeight - height) / 2,
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
