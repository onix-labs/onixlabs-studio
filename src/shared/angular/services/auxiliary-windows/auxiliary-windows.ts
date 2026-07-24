import { OnDestroy, Service } from '@angular/core';
import { AUX_PANEL_URL } from '@shared/api/window-channels';

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
 * Holds the document-root attributes mirrored into auxiliary windows, so their stylesheets resolve
 * the same theme and rendering policy as the opener's.
 */
const MIRRORED_ROOT_ATTRIBUTES: readonly string[] = [
  'data-theme-mode',
  'data-corners',
  'data-reduced-gpu',
  'style',
];

/**
 * Opens and manages auxiliary windows: same-renderer children (the one `window.open` target the
 * security guards allow) whose documents the opener builds and keeps styled. Because the child
 * shares the renderer process, DOM created here — including Angular component host elements —
 * renders there while every service, signal, and listener stays in this window's application.
 *
 * The service mirrors two live concerns into every open child: the application stylesheets (head
 * mutations are observed, so styles Angular injects for lazily-created components arrive too), and
 * the document-root theme attributes (mode, accent variables, corner policy).
 */
@Service()
export class AuxiliaryWindows implements OnDestroy {
  /**
   * Holds the open children.
   */
  private readonly children: Set<Window> = new Set<Window>();

  /**
   * Holds the observer mirroring theme attributes from this document's root into the children, or
   * null until the first window opens.
   */
  private rootObserver: MutationObserver | null = null;

  /**
   * Holds the observer mirroring newly-injected stylesheets into the children, or null until the
   * first window opens.
   */
  private headObserver: MutationObserver | null = null;

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

    this.mirrorStylesInto(doc);
    const auxStyles: HTMLStyleElement = doc.createElement('style');
    auxStyles.textContent = AUX_STYLES;
    doc.head.appendChild(auxStyles);
    this.applyRootAttributes(doc);

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
    this.ensureObservers();

    const closedListeners: (() => void)[] = [];
    let notified: boolean = false;
    const notifyClosed: () => void = (): void => {
      if (notified) {
        return;
      }
      notified = true;
      this.children.delete(child);
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
   * Clones the application's stylesheets into the given document, absolutising link targets so
   * they resolve from the child's blank URL.
   * @param doc The document to style.
   */
  private mirrorStylesInto(doc: Document): void {
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      doc.head.appendChild(this.cloneStyleNode(node, doc));
    }
  }

  /**
   * Clones a style or stylesheet-link node for an auxiliary document.
   * @param node The node to clone.
   * @param doc The destination document.
   * @returns Returns the clone.
   */
  private cloneStyleNode(node: Element, doc: Document): Node {
    const clone: Element = node.cloneNode(true) as Element;
    const href: string | null = node.getAttribute('href');
    if (clone.tagName === 'LINK' && href !== null) {
      clone.setAttribute('href', new URL(href, document.baseURI).href);
    }
    return doc.importNode(clone, true);
  }

  /**
   * Applies the opener's document-root theme attributes to the given document.
   * @param doc The document to update.
   */
  private applyRootAttributes(doc: Document): void {
    for (const name of MIRRORED_ROOT_ATTRIBUTES) {
      const value: string | null = document.documentElement.getAttribute(name);
      if (value === null) {
        doc.documentElement.removeAttribute(name);
      } else {
        doc.documentElement.setAttribute(name, value);
      }
    }
  }

  /**
   * Installs the live mirroring observers once.
   */
  private ensureObservers(): void {
    if (this.rootObserver !== null) {
      return;
    }
    this.rootObserver = new MutationObserver((): void => {
      for (const child of this.children) {
        this.applyRootAttributes(child.document);
      }
    });
    this.rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [...MIRRORED_ROOT_ATTRIBUTES],
    });

    this.headObserver = new MutationObserver((mutations: MutationRecord[]): void => {
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (
            added instanceof Element &&
            (added.tagName === 'STYLE' ||
              (added.tagName === 'LINK' && added.getAttribute('rel') === 'stylesheet'))
          ) {
            for (const child of this.children) {
              child.document.head.appendChild(this.cloneStyleNode(added, child.document));
            }
          }
        }
      }
    });
    this.headObserver.observe(document.head, { childList: true });
  }

  /**
   * Closes every auxiliary window and stops mirroring.
   */
  public ngOnDestroy(): void {
    for (const child of this.children) {
      child.close();
    }
    this.children.clear();
    this.rootObserver?.disconnect();
    this.headObserver?.disconnect();
  }
}
