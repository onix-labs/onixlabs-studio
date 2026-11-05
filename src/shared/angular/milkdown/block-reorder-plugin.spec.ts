import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/ctx';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { Slice } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

import { drainMilkdownTimers } from '../testing/drain-milkdown-timers';
import { blockReorderPlugin } from './block-reorder-plugin';

/**
 * The height each block is laid out at; blocks sit one advance apart.
 */
const blockHeight: number = 80;

/**
 * The distance between one block's top and the next's.
 */
const blockAdvance: number = 100;

/**
 * A pointer position over the top half of the block at the given index.
 */
function aboveMiddleOf(index: number): number {
  return index * blockAdvance + 10;
}

/**
 * The drag payload's one method the plugin calls.
 */
class FakeDataTransfer {
  public dragImages: Element[] = [];

  public setDragImage(image: Element): void {
    this.dragImages.push(image);
  }
}

/**
 * Builds a drag event. jsdom has no DragEvent, and the plugin reads only what a MouseEvent carries.
 */
function dragEvent(type: string, clientY: number, dataTransfer?: FakeDataTransfer): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientY }), {
    dataTransfer,
  });
}

describe('blockReorderPlugin', () => {
  let root: HTMLDivElement;
  let editor: Editor;
  let view: EditorView;

  /**
   * Creates a real editor with the plugin over the given markdown.
   */
  async function boot(markdown: string): Promise<void> {
    root = document.body.appendChild(document.createElement('div'));
    editor = await Editor.make()
      .config((ctx: Ctx): void => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, markdown);
      })
      .use(commonmark)
      .use(blockReorderPlugin)
      .create();
    view = editor.action((ctx: Ctx): EditorView => ctx.get(editorViewCtx));
  }

  /**
   * Lays the top-level blocks out in a column, jsdom having no layout of its own.
   */
  function layOut(): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ): DOMRect {
      const index: number = Array.from(view.dom.children).indexOf(this);
      return new DOMRect(16, index * blockAdvance, 400, blockHeight);
    });
  }

  /**
   * Starts a grip drag of a block the way Crepe's block handle does: it selects the block and flags
   * the editor.
   */
  function grip(index: number): void {
    let position: number = 0;
    for (let i: number = 0; i < index; i += 1) {
      position += view.state.doc.child(i).nodeSize;
    }
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)));
    view.dom.dataset['dragging'] = 'true';
    Object.assign(view, { dragging: { slice: Slice.empty, move: true } });
  }

  /**
   * Reads the top-level blocks' text, in document order.
   */
  function blocks(): readonly string[] {
    const texts: string[] = [];
    view.state.doc.forEach((node: { textContent: string }): void => {
      texts.push(node.textContent);
    });
    return texts;
  }

  /**
   * Finds the block elements carrying a reorder class.
   */
  function marked(className: string): readonly string[] {
    return Array.from(view.dom.querySelectorAll(`.${className}`)).map(
      (element: Element): string => element.textContent,
    );
  }

  /**
   * Determines whether the editor is flagged as mid-reorder.
   */
  function reordering(): boolean {
    return root.querySelector('.cdk-reordering') !== null;
  }

  /**
   * Reads the drag preview, if one is showing.
   */
  function ghost(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('.cdk-reorder-ghost');
  }

  beforeEach((): void => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
  });

  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await editor.destroy();
    root.remove();
  });

  // Milkdown's timer watchdogs cannot be cancelled; let them fire before the environment goes.
  afterAll(drainMilkdownTimers);

  describe('previewing', () => {
    it('dragOver_withoutAGripDrag_leavesTheBlocksAlone', async () => {
      await boot('one\n\ntwo\n');
      layOut();

      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(1)));

      expect(marked('cdk-reorder-shift')).toEqual([]);
      expect(reordering()).toBe(false);
    });

    it('dragOver_ofACaretSelection_doesNotStart', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      view.dom.dataset['dragging'] = 'true';

      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(1)));

      expect(reordering()).toBe(false);
    });

    it('dragOver_withASingleBlock_hasNothingToReorder', async () => {
      await boot('only\n');
      layOut();
      grip(0);

      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(0)));

      expect(reordering()).toBe(false);
    });

    it('dragOver_ofABlock_dimsItAndOpensAGapAtTheSlot', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(0);
      const over: MouseEvent = dragEvent('dragover', aboveMiddleOf(2));

      view.dom.dispatchEvent(over);

      expect(reordering()).toBe(true);
      expect(marked('cdk-reorder-dragged')).toEqual(['one']);
      expect(marked('cdk-reorder-shift')).toEqual(['two', 'three']);
      const two: Element | undefined = view.dom.children[1];
      // "two" moves up into the slot "one" left.
      expect((two as HTMLElement).style.transform).toBe(`translateY(-${blockAdvance}px)`);
      expect(over.defaultPrevented).toBe(true);
    });
  });

  describe('dropping', () => {
    it('drop_onALaterSlot_movesTheBlockThereAndLeavesACaretInIt', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(0);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(2)));

      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(2)));

      expect(blocks()).toEqual(['two', 'one', 'three']);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(view.state.selection.$from.parent.textContent).toBe('one');
      expect(reordering()).toBe(false);
      expect(marked('cdk-reorder-shift')).toEqual([]);
      expect(view.dragging).toBeNull();
    });

    it('drop_belowEveryBlock_movesItToTheEnd', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(0);
      view.dom.dispatchEvent(dragEvent('dragover', 9000));

      view.dom.dispatchEvent(dragEvent('drop', 9000));

      expect(blocks()).toEqual(['two', 'three', 'one']);
    });

    it('drop_onAnEarlierSlot_movesTheBlockUp', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(2);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(0)));

      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(0)));

      expect(blocks()).toEqual(['three', 'one', 'two']);
    });

    it('drop_backInPlace_changesNothingAndClearsThePreview', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      grip(1);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(1)));

      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(1)));

      expect(blocks()).toEqual(['one', 'two']);
      expect(reordering()).toBe(false);
      expect(marked('cdk-reorder-dragged')).toEqual([]);
    });

    it('dragEnd_outsideTheEditor_abandonsTheMove', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      grip(0);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(1)));

      document.dispatchEvent(new Event('dragend'));

      expect(blocks()).toEqual(['one', 'two']);
      expect(reordering()).toBe(false);
      expect(marked('cdk-reorder-dragged')).toEqual([]);
    });

    it('reselection_justAfterADrop_collapsesToACaret', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(0);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(2)));
      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(2)));

      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));

      expect(view.state.selection.empty).toBe(true);
    });

    it('selection_wellAfterADrop_isTheUsersToKeep', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(0);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(2)));
      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(2)));
      const dropped: number = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(dropped + 5000);

      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));

      expect(view.state.selection).toBeInstanceOf(NodeSelection);
    });
  });

  describe('the drag preview', () => {
    it('dragStart_ofAGrippedBlock_floatsACloneAtThePointer', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      grip(1);

      document.dispatchEvent(dragEvent('dragstart', aboveMiddleOf(1)));

      expect(ghost()?.textContent).toBe('two');
      expect(ghost()?.style.left).toBe('16px');
      expect(ghost()?.style.width).toBe('400px');
      expect(ghost()?.style.top).toBe('100px');
    });

    it('dragStart_withoutAGrip_showsNoPreview', async () => {
      await boot('one\n\ntwo\n');
      layOut();

      document.dispatchEvent(dragEvent('dragstart', 10));

      expect(ghost()).toBeNull();
    });

    it('dragStart_blanksTheNativeImageWithAPlaceholderThatGoesAway', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      grip(0);
      const transfer: FakeDataTransfer = new FakeDataTransfer();

      document.dispatchEvent(dragEvent('dragstart', 10, transfer));

      const image: Element | undefined = transfer.dragImages[0];
      expect(image?.isConnected).toBe(true);
      await vi.waitFor((): void => {
        expect(image?.isConnected).toBe(false);
      });
    });

    it('drag_movesThePreviewVerticallyOnly_andIgnoresTheBrowsersZero', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      grip(0);
      document.dispatchEvent(dragEvent('dragstart', 10));

      document.dispatchEvent(dragEvent('drag', 250));
      expect(ghost()?.style.top).toBe('240px');

      // Browsers report a final drag at (0, 0) as the pointer is released.
      document.dispatchEvent(dragEvent('drag', 0));
      expect(ghost()?.style.top).toBe('240px');
      expect(ghost()?.style.left).toBe('16px');
    });

    it('drop_removesThePreview', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(0);
      document.dispatchEvent(dragEvent('dragstart', 10));
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(2)));

      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(2)));

      expect(ghost()).toBeNull();
    });
  });

  describe('mid-flight', () => {
    it('editorDestroyed_duringADrag_removesThePreviewAndSurvivesTheDragEnd', async () => {
      await boot('one\n\ntwo\n');
      layOut();
      grip(0);
      document.dispatchEvent(dragEvent('dragstart', 10));
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(1)));

      await editor.destroy();

      expect(ghost()).toBeNull();
      const errors: ErrorEvent[] = [];
      const collect: (event: ErrorEvent) => void = (event: ErrorEvent): void => {
        errors.push(event);
      };
      window.addEventListener('error', collect);
      document.dispatchEvent(new Event('dragend'));
      window.removeEventListener('error', collect);
      expect(errors).toEqual([]);
      await boot('after\n');
    });

    it('documentShrinks_duringADrag_endsTheDragWithoutThrowing', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(1);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(2)));

      // An agent or the file on disk changes the document while the block is held.
      const size: number = view.state.doc.child(0).nodeSize;
      expect((): void => {
        view.dispatch(view.state.tr.delete(0, size));
      }).not.toThrow();
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(0)));
      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(0)));

      expect(blocks()).toEqual(['two', 'three']);
      expect(reordering()).toBe(false);
      expect(marked('cdk-reorder-shift')).toEqual([]);
    });

    it('documentEdited_beforeTheDrop_doesNotMoveABlockToAStalePosition', async () => {
      await boot('one\n\ntwo\n\nthree\n');
      layOut();
      grip(2);
      view.dom.dispatchEvent(dragEvent('dragover', aboveMiddleOf(1)));

      view.dispatch(view.state.tr.insertText('edited ', 1));
      view.dom.dispatchEvent(dragEvent('drop', aboveMiddleOf(1)));

      expect(blocks()).toEqual(['edited one', 'two', 'three']);
      expect(reordering()).toBe(false);
    });
  });
});
