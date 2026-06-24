import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction, PluginView } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';

/**
 * Index of the first element in document-order arrays.
 */
const FIRST_INDEX: number = 0;

/**
 * Lowest valid clamp/offset value (zero).
 */
const ZERO: number = 0;

/**
 * Step used when iterating to or indexing the next sibling block.
 */
const NEXT_STEP: number = 1;

/**
 * Divisor used to find the vertical midpoint of a block.
 */
const HALF_DIVISOR: number = 2;

/**
 * Minimum number of top-level blocks required for reordering to apply.
 */
const MIN_BLOCKS: number = 2;

/**
 * Sentinel index meaning "no source / target block".
 */
const NO_INDEX: number = -1;

/**
 * Mapping bias used when mapping the insertion position through deletions.
 */
const MAP_BIAS: number = -1;

/**
 * Drag-image hotspot offset; zero pins the suppressed native image to its origin.
 */
const DRAG_IMAGE_HOTSPOT: number = 0;

/**
 * Timeout (ms) used to defer placeholder removal until after the drag snapshot.
 */
const IMMEDIATE_TIMEOUT: number = 0;

/**
 * Splice delete-count of zero, used to insert without removing elements.
 */
const NO_DELETE: number = 0;

/**
 * CDK-style block reordering.
 *
 * Crepe's built-in BlockEdit feature reorders blocks using ProseMirror's native
 * drag/drop, which only shows a thick drop-cursor line and reorders the DOM on
 * drop. This plugin replaces that with Angular-CDK-like behaviour: while a block
 * is dragged, the surrounding blocks animate to open a gap at the target slot
 * (a FLIP transform applied through ProseMirror node decorations, so PM manages
 * the styles and does not clobber them), and the dragged block dims into a
 * placeholder. The move itself is performed on drop so the result matches the
 * previewed order exactly (no snap).
 *
 * The native HTML5 drag image is suppressed and replaced with a cloned-block
 * "ghost" appended to document.body whose left is pinned to the source block's
 * original X and whose top tracks the pointer Y — i.e. the preview moves on
 * the Y axis only, like CDK's `cdkDropList` with vertical orientation.
 */

const reorderKey: PluginKey<ReorderState> = new PluginKey<ReorderState>('cdk-block-reorder');

/** Plugin state, updated via transaction metadata as the drag progresses. */
interface ReorderState {
  /** Whether a block reorder drag is in progress. */
  readonly active: boolean;
  /** Index of the dragged top-level block (in document order). */
  readonly source: number;
  /** Index of the top-level block before which the dragged block will land (0..n; n = end). */
  readonly insertBefore: number;
}

/** Geometry snapshot captured at drag start, in document order. */
interface Metrics {
  /** Document position before each top-level node. */
  readonly positions: number[];
  /** DOM element for each top-level node. */
  readonly doms: HTMLElement[];
  /** Viewport top of each block at drag start. */
  readonly tops: number[];
  /** Height of each block at drag start. */
  readonly heights: number[];
  /** Vertical advance (height + gap) of each block, used to compute target positions. */
  readonly advances: number[];
  /** Number of top-level blocks. */
  readonly n: number;
}

const TRANSITION: string = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
const REORDERING_CLASS: string = 'cdk-reordering';

/**
 * The CDK-style block reordering plugin, ready to pass to `crepe.editor.use(...)`.
 */
export const blockReorderPlugin: $Prose = $prose((): Plugin<ReorderState> => {
  // Per-editor drag geometry; null when no drag is active.
  let metrics: Metrics | null = null;
  // Native dragend listener, registered on document during a drag so cleanup
  // runs even when the drop happens outside the editor.
  let onDocumentDragEnd: (() => void) | null = null;
  // Document-level listeners that drive the Y-locked custom ghost, registered
  // on plugin init and cleaned up on destroy.
  let onDocumentDragStart: ((e: DragEvent) => void) | null = null;
  let onDocumentDrag: ((e: DragEvent) => void) | null = null;

  // Floating ghost preview that follows the cursor (Y axis only).
  let ghostEl: HTMLElement | null = null;
  let ghostLeft: number = 0;
  let ghostWidth: number = 0;
  let ghostGrabOffsetY: number = 0;

  /**
   * Removes the ghost element. Safe to call when no ghost exists.
   */
  function destroyGhost(): void {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
  }

  /**
   * Clones the source block into a fixed-position ghost on document.body and
   * suppresses the native HTML5 drag image so the only drag preview is ours.
   *
   * @param view The editor view whose selected block is being dragged.
   * @param event The native dragstart event that initiated the drag.
   */
  function createGhost(view: EditorView, event: DragEvent): void {
    destroyGhost();
    const selection: EditorState['selection'] = view.state.selection;
    if (!(selection instanceof NodeSelection)) return;
    const sourceDom: Node | null = view.nodeDOM(selection.from);
    if (!(sourceDom instanceof HTMLElement)) return;

    const sourceRect: DOMRect = sourceDom.getBoundingClientRect();
    ghostLeft = sourceRect.left;
    ghostWidth = sourceRect.width;
    ghostGrabOffsetY = Math.max(ZERO, Math.min(sourceRect.height, event.clientY - sourceRect.top));

    const ghost: HTMLElement = sourceDom.cloneNode(true) as HTMLElement;
    ghost.classList.add('cdk-reorder-ghost');
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.margin = '0';
    ghost.style.width = `${ghostWidth}px`;
    ghost.style.left = `${ghostLeft}px`;
    ghost.style.top = `${event.clientY - ghostGrabOffsetY}px`;
    document.body.appendChild(ghost);
    ghostEl = ghost;

    // Suppress the native drag image. Use an off-screen placeholder element so
    // the browser has something to snapshot but it never appears on screen.
    if (event.dataTransfer) {
      const placeholder: HTMLDivElement = document.createElement('div');
      placeholder.style.position = 'fixed';
      placeholder.style.top = '-9999px';
      placeholder.style.left = '-9999px';
      placeholder.style.width = '1px';
      placeholder.style.height = '1px';
      document.body.appendChild(placeholder);
      event.dataTransfer.setDragImage(placeholder, DRAG_IMAGE_HOTSPOT, DRAG_IMAGE_HOTSPOT);
      // Remove the placeholder after the browser has captured the (blank) image.
      setTimeout((): void => placeholder.remove(), IMMEDIATE_TIMEOUT);
    }
  }

  /**
   * Updates the ghost's vertical position. Left/width are pinned to the source's
   * original column so the preview moves only on the Y axis.
   *
   * @param clientY The pointer's current viewport Y coordinate.
   */
  function updateGhost(clientY: number): void {
    if (!ghostEl || clientY <= ZERO) return;
    ghostEl.style.top = `${clientY - ghostGrabOffsetY}px`;
  }

  /**
   * Captures the geometry of every top-level block at the start of a drag.
   *
   * @param view The editor view to measure.
   * @returns The captured geometry, or null when there are too few blocks.
   */
  function collectMetrics(view: EditorView): Metrics | null {
    const positions: number[] = [];
    const doms: HTMLElement[] = [];
    const tops: number[] = [];
    const heights: number[] = [];

    view.state.doc.forEach((node: ProseMirrorNode, offset: number): void => {
      const dom: Node | null = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        positions.push(offset);
        doms.push(dom);
        const rect: DOMRect = dom.getBoundingClientRect();
        tops.push(rect.top);
        heights.push(rect.height);
      }
    });

    const n: number = positions.length;
    if (n < MIN_BLOCKS) return null;

    const advances: number[] = [];
    for (let i: number = FIRST_INDEX; i < n; i++) {
      if (i < n - NEXT_STEP) {
        advances.push(tops[i + NEXT_STEP] - tops[i]);
      } else {
        // Last block has no following sibling; approximate its advance using the
        // gap observed between the previous two blocks.
        const prevGap: number =
          i > FIRST_INDEX ? Math.max(ZERO, advances[i - NEXT_STEP] - heights[i - NEXT_STEP]) : ZERO;
        advances.push(heights[i] + prevGap);
      }
    }

    return { positions, doms, tops, heights, advances, n };
  }

  /**
   * Determines the slot (block index) the pointer is currently over.
   * Uses the drag-start snapshot so it is unaffected by the live transforms.
   *
   * @param clientY The pointer's current viewport Y coordinate.
   * @param m The drag-start geometry snapshot.
   * @returns The index of the slot the pointer is over.
   */
  function computeInsertBefore(clientY: number, m: Metrics): number {
    for (let i: number = FIRST_INDEX; i < m.n; i++) {
      if (clientY < m.tops[i] + m.heights[i] / HALF_DIVISOR) return i;
    }
    return m.n;
  }

  /**
   * Removes drag visuals and resets plugin state. When `dispatchReset` is true,
   * a metadata-only transaction clears the decorations; the move handler folds
   * the reset into its own transaction instead.
   *
   * @param view The editor view being cleaned up.
   * @param dispatchReset Whether to dispatch a metadata-only reset transaction.
   */
  function cleanup(view: EditorView, dispatchReset: boolean): void {
    metrics = null;
    destroyGhost();
    view.dom.closest('.milkdown')?.classList.remove(REORDERING_CLASS);
    if (onDocumentDragEnd) {
      document.removeEventListener('dragend', onDocumentDragEnd);
      onDocumentDragEnd = null;
    }
    if (dispatchReset) {
      const tr: Transaction = view.state.tr.setMeta(reorderKey, {
        active: false,
        source: NO_INDEX,
        insertBefore: NO_INDEX,
      });
      // Deselect the dragged block so a cancelled or in-place drop leaves nothing selected.
      if (view.state.selection instanceof NodeSelection) {
        tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.selection.from), NEXT_STEP));
      }
      view.dispatch(tr);
    }
  }

  /**
   * Lazily begins a reorder once the native block drag is detected over the editor.
   * Returns true if a reorder is now (or already) active.
   *
   * @param view The editor view receiving the drag.
   * @returns True when a reorder is now (or already) active.
   */
  function ensureActive(view: EditorView): boolean {
    if (metrics) return true;

    // The block plugin marks the editor and selects the dragged block.
    if (view.dom.dataset['dragging'] !== 'true') return false;
    const selection: EditorState['selection'] = view.state.selection;
    if (!(selection instanceof NodeSelection)) return false;

    const m: Metrics | null = collectMetrics(view);
    if (!m) return false;
    const source: number = m.positions.indexOf(selection.from);
    if (source < FIRST_INDEX) return false;

    metrics = m;
    view.dom.closest('.milkdown')?.classList.add(REORDERING_CLASS);

    onDocumentDragEnd = (): void => cleanup(view, true);
    document.addEventListener('dragend', onDocumentDragEnd, { once: true });

    view.dispatch(
      view.state.tr.setMeta(reorderKey, { active: true, source, insertBefore: source }),
    );
    return true;
  }

  return new Plugin<ReorderState>({
    key: reorderKey,

    state: {
      init: (): ReorderState => ({ active: false, source: NO_INDEX, insertBefore: NO_INDEX }),
      apply(tr: Transaction, value: ReorderState): ReorderState {
        const meta: Partial<ReorderState> | undefined = tr.getMeta(reorderKey) as
          | Partial<ReorderState>
          | undefined;
        return meta ? { ...value, ...meta } : value;
      },
    },

    view(view: EditorView): PluginView {
      // Block-plugin's grip is appended to view.dom.parentElement, so dragstart
      // on the grip never bubbles into view.dom. Listen on document instead.
      onDocumentDragStart = (event: DragEvent): void => {
        // After block-plugin's handler has bubbled, view.dragging is set if
        // this drag originates from the block grip.
        if (!view.dragging) return;
        if (!(view.state.selection instanceof NodeSelection)) return;
        createGhost(view, event);
      };
      onDocumentDrag = (event: DragEvent): void => {
        updateGhost(event.clientY);
      };
      document.addEventListener('dragstart', onDocumentDragStart);
      document.addEventListener('drag', onDocumentDrag);

      return {
        destroy(): void {
          if (onDocumentDragStart) {
            document.removeEventListener('dragstart', onDocumentDragStart);
            onDocumentDragStart = null;
          }
          if (onDocumentDrag) {
            document.removeEventListener('drag', onDocumentDrag);
            onDocumentDrag = null;
          }
          destroyGhost();
        },
      };
    },

    props: {
      decorations(state: EditorState): DecorationSet {
        const ds: ReorderState | undefined = reorderKey.getState(state);
        const m: Metrics | null = metrics;
        if (!ds || !ds.active || !m) return DecorationSet.empty;

        // Build the post-drop block order.
        const order: number[] = [];
        for (let i: number = FIRST_INDEX; i < m.n; i++) {
          if (i !== ds.source) order.push(i);
        }
        let insAdj: number =
          ds.insertBefore > ds.source ? ds.insertBefore - NEXT_STEP : ds.insertBefore;
        insAdj = Math.max(ZERO, Math.min(insAdj, order.length));
        order.splice(insAdj, NO_DELETE, ds.source);

        // Lay out the new order using the captured advances, then translate each
        // block from its original top to its new top.
        const newTop: number[] = new Array<number>(m.n);
        let cursor: number = m.tops[0];
        for (let k: number = FIRST_INDEX; k < m.n; k++) {
          const idx: number = order[k];
          newTop[idx] = cursor;
          cursor += m.advances[idx];
        }

        const decorations: Decoration[] = [];
        for (let i: number = FIRST_INDEX; i < m.n; i++) {
          const delta: number = Math.round(newTop[i] - m.tops[i]);
          const isSource: boolean = i === ds.source;
          const style: string = `transition: ${TRANSITION}; transform: translateY(${delta}px);`;
          const cls: string = isSource ? 'cdk-reorder-dragged' : 'cdk-reorder-shift';
          const node: ProseMirrorNode = state.doc.child(i);
          decorations.push(
            Decoration.node(m.positions[i], m.positions[i] + node.nodeSize, { style, class: cls }),
          );
        }

        return DecorationSet.create(state.doc, decorations);
      },

      handleDOMEvents: {
        dragover: (view: EditorView, event: DragEvent): boolean => {
          try {
            if (!ensureActive(view)) return false;
            const m: Metrics | null = metrics;
            if (!m) return false;

            updateGhost(event.clientY);

            const insertBefore: number = computeInsertBefore(event.clientY, m);
            const ds: ReorderState | undefined = reorderKey.getState(view.state);
            if (ds && ds.active && ds.insertBefore !== insertBefore) {
              view.dispatch(view.state.tr.setMeta(reorderKey, { ...ds, insertBefore }));
            }
            // Allow the drop by indicating this is a valid drop target.
            event.preventDefault();
          } catch {
            cleanup(view, true);
          }
          return false;
        },

        drop: (view: EditorView, event: DragEvent): boolean => {
          const ds: ReorderState | undefined = reorderKey.getState(view.state);
          const m: Metrics | null = metrics;
          if (!ds || !ds.active || !m) return false;

          try {
            event.preventDefault();
            const selection: EditorState['selection'] = view.state.selection;
            const insertBefore: number = computeInsertBefore(event.clientY, m);

            if (
              selection instanceof NodeSelection &&
              insertBefore !== ds.source &&
              insertBefore !== ds.source + NEXT_STEP
            ) {
              const node: ProseMirrorNode = selection.node;
              const from: number = selection.from;
              const insPos: number =
                insertBefore >= m.n ? view.state.doc.content.size : m.positions[insertBefore];

              const tr: Transaction = view.state.tr;
              tr.delete(from, from + node.nodeSize);
              const mapped: number = tr.mapping.map(insPos, MAP_BIAS);
              tr.insert(mapped, node);
              // Collapse to a caret in the moved block so nothing is left selected after the drop.
              tr.setSelection(TextSelection.near(tr.doc.resolve(mapped), NEXT_STEP));
              // Fold the visual reset into the move so decorations clear in the
              // same render and never reference stale positions.
              tr.setMeta(reorderKey, { active: false, source: NO_INDEX, insertBefore: NO_INDEX });
              view.dispatch(tr.scrollIntoView());
              view.dragging = null;
              cleanup(view, false);
              return true;
            }

            // No-op move (dropped back in place): just clear the visuals.
            view.dragging = null;
            cleanup(view, true);
            return true;
          } catch {
            cleanup(view, true);
            return false;
          }
        },
      },
    },
  });
});
