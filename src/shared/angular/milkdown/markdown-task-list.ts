import type { Ctx } from '@milkdown/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import { type Node as ProseMirrorNode, type NodeType } from '@milkdown/kit/prose/model';
import type { Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { wrapInBulletListCommand } from '@milkdown/preset-commonmark';
import { callCommand } from '@milkdown/utils';

/**
 * A list item overlapping the selection, paired with its document position.
 */
interface ListItemHit {
  /**
   * Gets the list-item node.
   */
  readonly node: ProseMirrorNode;

  /**
   * Gets the node's start position in the document.
   */
  readonly pos: number;
}

/**
 * Collects the list-item nodes overlapping the current selection.
 * @param view The editor view.
 * @param listItem The list-item node type.
 * @returns Returns the overlapping list items, in document order.
 */
function collectListItems(view: EditorView, listItem: NodeType): readonly ListItemHit[] {
  const { from, to } = view.state.selection;
  const hits: ListItemHit[] = [];
  view.state.doc.nodesBetween(from, to, (node: ProseMirrorNode, pos: number): void => {
    if (node.type === listItem) {
      hits.push({ node, pos });
    }
  });
  return hits;
}

/**
 * Toggles a GFM task (checkbox) list on the list item(s) overlapping the selection. A selection that is
 * not already in a list is first wrapped in a bullet list so there are items to mark. If every covered
 * item is already a task the toggle reverts them to plain list items; otherwise it makes them all
 * unchecked tasks. The task state is the GFM preset's `checked` attribute on the `list_item` node
 * (`null` for a plain item, a boolean for a task), so this no-ops when that preset is not loaded.
 * @param ctx The Milkdown editor context.
 */
export function toggleTaskList(ctx: Ctx): void {
  const view: EditorView = ctx.get(editorViewCtx);
  const listItem: NodeType | undefined = view.state.schema.nodes['list_item'];
  if (listItem === undefined) {
    return;
  }
  // The `checked` attribute is contributed by the GFM preset; without it there is nothing to toggle.
  if (listItem.spec.attrs?.['checked'] === undefined) {
    return;
  }

  // Loose blocks have no list items to mark, so wrap them in a bullet list first. The command updates
  // the view's state synchronously, so the items are then visible to a fresh scan.
  if (collectListItems(view, listItem).length === 0) {
    callCommand(wrapInBulletListCommand.key)(ctx);
  }

  const hits: readonly ListItemHit[] = collectListItems(view, listItem);
  if (hits.length === 0) {
    return;
  }

  // Turn plain items into tasks; only when every covered item is already a task do we clear them.
  const checked: boolean | null = hits.some(
    (hit: ListItemHit): boolean => hit.node.attrs['checked'] === null,
  )
    ? false
    : null;

  const transaction: Transaction = view.state.tr;
  for (const hit of hits) {
    transaction.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, checked });
  }
  if (transaction.docChanged) {
    view.dispatch(transaction);
  }
  view.focus();
}
