import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';
import type { Plugin } from '@milkdown/kit/prose/state';
import { search } from 'prosemirror-search';

/**
 * The ProseMirror search plugin, ready to pass to `crepe.editor.use(...)`.
 *
 * It backs the shared find panel's markdown adapter: it holds the active search query and paints the
 * match highlights, while the adapter drives it (setting the query, navigating, and replacing) through
 * the editor view. Inert until a query is set, so it is safe to register unconditionally.
 */
export const searchPlugin: $Prose = $prose((): Plugin => search());
