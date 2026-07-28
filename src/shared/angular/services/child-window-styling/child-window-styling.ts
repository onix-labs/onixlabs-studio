import { OnDestroy, Service } from '@angular/core';

/**
 * Holds the document-root attributes mirrored into child windows, so their stylesheets resolve the
 * same theme and rendering policy as the opener's.
 */
const MIRRORED_ROOT_ATTRIBUTES: readonly string[] = [
  'data-theme-mode',
  'data-corners',
  'data-reduced-gpu',
  'style',
];

/**
 * Keeps same-renderer child windows — pop-out panel windows and modal windows alike — looking like
 * the window that opened them.
 *
 * A child window is opened on `about:blank`, so it starts with no styling of its own. This service
 * clones the application's stylesheets into it and copies the document-root theme attributes
 * (mode, accent variables, corner policy) across, then keeps both mirrors live: head mutations are
 * observed, so styles Angular injects for lazily-created components arrive in every open child, and
 * root-attribute changes (a theme switch, a new accent) are re-applied.
 */
@Service()
export class ChildWindowStyling implements OnDestroy {
  /**
   * Holds the styled children.
   */
  private readonly children: Set<Window> = new Set<Window>();

  /**
   * Holds the observer mirroring theme attributes from this document's root into the children, or
   * null until the first child is adopted.
   */
  private rootObserver: MutationObserver | null = null;

  /**
   * Holds the observer mirroring newly-injected stylesheets into the children, or null until the
   * first child is adopted.
   */
  private headObserver: MutationObserver | null = null;

  /**
   * Styles a child window and keeps it in step with the opener until it is released.
   * @param child The child window to style.
   */
  public adopt(child: Window): void {
    const doc: Document = child.document;
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      doc.head.appendChild(this.cloneStyleNode(node, doc));
    }
    this.applyRootAttributes(doc);
    this.children.add(child);
    this.ensureObservers();
  }

  /**
   * Stops mirroring into a child window. Unknown windows are ignored.
   * @param child The child window to release.
   */
  public release(child: Window): void {
    this.children.delete(child);
  }

  /**
   * Appends a stylesheet of the opener's own — a `<style>` element holding structural styles the
   * child needs but the application does not — to a child document.
   * @param doc The child document to extend.
   * @param css The stylesheet text to append.
   */
  public appendStyles(doc: Document, css: string): void {
    const element: HTMLStyleElement = doc.createElement('style');
    element.textContent = css;
    doc.head.appendChild(element);
  }

  /**
   * Clones a style or stylesheet-link node for a child document.
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
   * Stops mirroring into every child.
   */
  public ngOnDestroy(): void {
    this.children.clear();
    this.rootObserver?.disconnect();
    this.headObserver?.disconnect();
  }
}
