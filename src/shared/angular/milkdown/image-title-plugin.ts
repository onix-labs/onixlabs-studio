/**
 * Milkdown plugin that gives an untitled markdown image an empty title rather than none.
 *
 * remark parses `![alt](pic.png)` with `title: null`, and Milkdown's image schema (and Crepe's
 * image block, which carries the title as its caption) pass that straight into an attribute declared
 * `validate: 'string'`. prosemirror-model 1.25.12 enforces the declaration, so the parse throws and
 * the document opens empty. An empty title is what the schemas default to, and the serializer omits
 * it, so the markdown round-trips unchanged.
 */

import { $remark } from '@milkdown/kit/utils';
import type { $Remark } from '@milkdown/utils';
import type { Node as UnistNode } from 'unist';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * The mdast node types that carry an image's title: remark's own, and the block Crepe's image-block
 * feature rewrites a lone image into.
 */
const IMAGE_TYPES: ReadonlySet<string> = new Set<string>(['image', 'image-block']);

/**
 * Describes an mdast node that may carry a title.
 */
interface TitledNode extends UnistNode {
  title?: string | null;
}

/**
 * Remark plugin that replaces a missing image title with an empty one, ready to pass to
 * `crepe.editor.use(...)`.
 */
export const imageTitlePlugin: $Remark<'remarkImageTitle', undefined> = $remark(
  'remarkImageTitle',
  (): (() => (tree: Root) => Root) =>
    (): ((tree: Root) => Root) =>
    (tree: Root): Root => {
      visit(tree, (node: TitledNode): void => {
        if (IMAGE_TYPES.has(node.type) && node.title == null) node.title = '';
      });
      return tree;
    },
);
