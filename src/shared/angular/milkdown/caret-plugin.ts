import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';
import type { CursorBlinkingStyle } from '@shared/angular/services/settings/settings';

/**
 * Plugin key for the drawn caret.
 */
const caretKey: PluginKey = new PluginKey('markdown-caret');

/**
 * Draws the caret itself, in place of the browser's, whose blink cannot be changed. Only used for the
 * styles other than Blink, which is what the browser's caret does already.
 */
class DrawnCaret {
  /**
   * Holds the caret's element, a sibling of the document so that ProseMirror never sees it.
   */
  private readonly element: HTMLElement;

  /**
   * Holds the observer that keeps the caret in place as the document reflows.
   */
  private readonly resize: ResizeObserver;

  /**
   * Holds the listener that places the caret as the view takes or loses focus.
   */
  private readonly place: () => void = (): void => this.update();

  /**
   * Initializes a new instance of the {@link DrawnCaret} class.
   * @param view The editor view.
   * @param blinking The blinking style.
   */
  public constructor(
    private readonly view: EditorView,
    blinking: CursorBlinkingStyle,
  ) {
    const ownerDocument: Document = view.dom.ownerDocument;
    this.element = ownerDocument.createElement('div');
    this.element.className = `markdown-caret markdown-caret--${blinking}`;
    view.dom.parentElement?.appendChild(this.element);
    view.dom.addEventListener('focus', this.place);
    view.dom.addEventListener('blur', this.place);
    this.resize = new ResizeObserver(this.place);
    this.resize.observe(view.dom);
    this.update();
  }

  /**
   * Places the caret at the selection's head, or hides it for a range or an unfocused document.
   */
  public update(): void {
    const parent: HTMLElement | null = this.element.parentElement;
    if (parent === null || !this.view.hasFocus() || !this.view.state.selection.empty) {
      this.element.style.display = 'none';
      return;
    }
    try {
      const head: { top: number; bottom: number; left: number } = this.view.coordsAtPos(
        this.view.state.selection.head,
      );
      const origin: DOMRect = parent.getBoundingClientRect();
      this.element.style.display = 'block';
      this.element.style.top = `${head.top - origin.top}px`;
      this.element.style.left = `${head.left - origin.left}px`;
      this.element.style.height = `${head.bottom - head.top}px`;
    } catch {
      // The position can be mid-update for a moment; the next update places it.
      this.element.style.display = 'none';
    }
  }

  /**
   * Removes the caret and its listeners.
   */
  public destroy(): void {
    this.resize.disconnect();
    this.view.dom.removeEventListener('focus', this.place);
    this.view.dom.removeEventListener('blur', this.place);
    this.element.remove();
  }
}

/**
 * Builds the plugin that draws the caret with a blinking style the browser's caret does not have.
 * @param blinking The blinking style.
 * @returns Returns the Milkdown plugin.
 */
export function createCaretPlugin(blinking: CursorBlinkingStyle): $Prose {
  return $prose(
    (): Plugin =>
      new Plugin({
        key: caretKey,
        props: { attributes: { class: 'markdown-drawn-caret' } },
        view: (view: EditorView): DrawnCaret => new DrawnCaret(view, blinking),
      }),
  );
}
