import { inject, OnDestroy, Service } from '@angular/core';
import { AUX_PANEL_URL } from '@shared/api/window-channels';
import { watchChildWindowClosed } from '@shared/angular/services/child-window-close/child-window-close';
import { ChildWindowStyling } from '@shared/angular/services/child-window-styling/child-window-styling';

/**
 * One auxiliary window: a same-renderer child window whose DOM the opener scripts directly, hosting
 * a surface that keeps living inside this window's Angular application.
 */
export interface AuxiliaryWindow {
  /**
   * Gets the element hosted content renders into (below the title bar).
   */
  readonly contentHost: HTMLElement;

  /**
   * Determines whether a screen point lies within the window's frame, for hit-testing a drag
   * released over it.
   * @param screenX The point's screen x coordinate.
   * @param screenY The point's screen y coordinate.
   * @returns Returns true when the point is inside the window.
   */
  containsScreenPoint(screenX: number, screenY: number): boolean;

  /**
   * Brings the window to the front.
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
 * The screen position an auxiliary window opens at, when the opener places it (a tear-out drag
 * dropping at the cursor). Requested through the window-open features and clamped by the main
 * process against the current displays.
 */
export interface AuxiliaryWindowPosition {
  /**
   * Gets the screen x coordinate of the window's left edge.
   */
  readonly x: number;

  /**
   * Gets the screen y coordinate of the window's top edge.
   */
  readonly y: number;
}

/**
 * Holds the structural styles for the auxiliary window's own chrome (title bar + content column).
 * Everything else — colours, fonts, component styles — comes from the application stylesheets the
 * opener mirrors into the child, so the window tracks the app's theme tokens.
 */
const AUX_STYLES: string = `
  body { margin: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden;
         background: var(--root-content-background-color); }
  .aux-window__titlebar { display: flex; align-items: center; flex: none;
    padding-block: 0.75rem; padding-inline: 5.5rem 0.75rem;
    background: var(--title-strip-background-color);
    -webkit-app-region: drag; user-select: none; }
  .aux-window__title { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; font-size: 0.8rem; font-weight: 600;
    color: var(--title-strip-button-foreground-color--hover); }
  .aux-window__content { flex: 1; min-block-size: 0; display: flex; flex-direction: column; }
  .aux-window__content > * { flex: 1; min-block-size: 0; }
`;

/**
 * Opens and manages auxiliary windows: same-renderer children (one of the two `window.open` targets
 * the security guards allow) whose documents the opener builds and keeps styled. Because the child
 * shares the renderer process, DOM created here — including Angular component host elements —
 * renders there while every service, signal, and listener stays in this window's application.
 *
 * Styling — the application stylesheets and the document-root theme attributes — is mirrored into
 * every open child by {@link ChildWindowStyling}, shared with modal windows.
 */
@Service()
export class AuxiliaryWindows implements OnDestroy {
  /**
   * Holds the styling mirror keeping open children in step with this window.
   */
  private readonly styling: ChildWindowStyling = inject(ChildWindowStyling);

  /**
   * Holds the open children.
   */
  private readonly children: Set<Window> = new Set<Window>();

  /**
   * Opens an auxiliary window with the application's chrome and styling.
   * @param title The window title, also shown in its title bar.
   * @param at The screen position to open at, or undefined to use the persisted pop-out bounds.
   * @returns Returns the window, or null when it could not be opened.
   */
  public open(title: string, at?: AuxiliaryWindowPosition): AuxiliaryWindow | null {
    // The position rides the features string; the main process parses and clamps it against the
    // displays before it reaches the window constructor.
    const features: string = at === undefined ? '' : `left=${at.x},top=${at.y}`;
    const child: Window | null = window.open(AUX_PANEL_URL, '_blank', features);
    if (child === null) {
      return null;
    }
    const doc: Document = child.document;
    doc.title = title;

    this.styling.adopt(child);
    this.styling.appendStyles(doc, AUX_STYLES);

    const titlebar: HTMLElement = doc.createElement('header');
    titlebar.className = 'aux-window__titlebar';
    const titleText: HTMLElement = doc.createElement('span');
    titleText.className = 'aux-window__title';
    titleText.textContent = title;
    titlebar.appendChild(titleText);
    const contentHost: HTMLElement = doc.createElement('main');
    contentHost.className = 'aux-window__content';
    doc.body.appendChild(titlebar);
    doc.body.appendChild(contentHost);

    this.children.add(child);

    const closedListeners: (() => void)[] = [];
    watchChildWindowClosed(child, (): void => {
      this.children.delete(child);
      this.styling.release(child);
      for (const listener of closedListeners) {
        listener();
      }
    });

    return {
      contentHost,
      containsScreenPoint: (screenX: number, screenY: number): boolean =>
        !child.closed &&
        screenX >= child.screenX &&
        screenX <= child.screenX + child.outerWidth &&
        screenY >= child.screenY &&
        screenY <= child.screenY + child.outerHeight,
      focus: (): void => child.focus(),
      close: (): void => child.close(),
      onClosed: (listener: () => void): void => {
        closedListeners.push(listener);
      },
    };
  }

  /**
   * Closes every auxiliary window and stops mirroring into them.
   */
  public ngOnDestroy(): void {
    for (const child of this.children) {
      this.styling.release(child);
      child.close();
    }
    this.children.clear();
  }
}
