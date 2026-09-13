import { NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';

/**
 * Plugin key for the divider click-to-select plugin.
 */
const dividerSelectKey: PluginKey = new PluginKey('divider-select');

/**
 * Selects the clicked divider, so the keyboard can act on it (Backspace/Delete removes it, typing
 * replaces it).
 * @param view The editor view.
 * @param node The clicked node.
 * @param nodePos The clicked node's document position.
 * @returns Returns true when the click selected a divider.
 */
export function selectDividerOnClick(
  view: EditorView,
  node: ProseMirrorNode,
  nodePos: number,
): boolean {
  if (node.type.name !== 'hr') {
    return false;
  }
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
  return true;
}

/**
 * Makes a divider (horizontal rule) selectable by clicking it.
 *
 * A divider is a leaf atom with no text position of its own: without an explicit selection a click
 * lands the caret beside it, nothing indicates the divider itself can be targeted, and there is no
 * way to delete it but from the paragraph after it. Clicking one now gives it a node selection —
 * rendered by the stylesheet's selected state — from which Backspace and Delete remove it and typing
 * replaces it.
 */
export const dividerSelectPlugin: $Prose = $prose(
  (): Plugin =>
    new Plugin({
      key: dividerSelectKey,
      props: {
        handleClickOn: (
          view: EditorView,
          _pos: number,
          node: ProseMirrorNode,
          nodePos: number,
          _event: MouseEvent,
          direct: boolean,
        ): boolean => direct && selectDividerOnClick(view, node, nodePos),
      },
    }),
);
