import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';
import type { MarkdownOpenLinks } from '@shared/angular/services/settings/settings-registry';

/**
 * Plugin key for the link-opening ProseMirror plugin.
 */
const linkOpenKey: PluginKey = new PluginKey('link-open');

/**
 * Decides whether a click opens the link under it.
 * @param mode The Open Links setting.
 * @param withModifier Whether ⌘ (Ctrl elsewhere) was held.
 * @returns Returns true when the click opens the link.
 */
export function clickOpensLink(mode: MarkdownOpenLinks, withModifier: boolean): boolean {
  switch (mode) {
    case 'click':
      return true;
    case 'modifier':
      return withModifier;
    case 'tooltip':
      return false;
  }
}

/**
 * Builds the plugin that opens a document's links on the click the Open Links setting names. Links
 * inside the editable document do nothing of their own, so without this only their tooltip opens them.
 * @param mode The Open Links setting.
 * @param open Opens the link's address.
 * @returns Returns the Milkdown plugin.
 */
export function createLinkOpenPlugin(
  mode: MarkdownOpenLinks,
  open: (href: string) => void,
): $Prose {
  return $prose(
    (): Plugin =>
      new Plugin({
        key: linkOpenKey,
        props: {
          handleClick: (_view: EditorView, _pos: number, event: MouseEvent): boolean => {
            const link: HTMLAnchorElement | null =
              (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]') ?? null;
            if (link === null || !clickOpensLink(mode, event.metaKey || event.ctrlKey)) {
              return false;
            }
            open(link.getAttribute('href') ?? '');
            event.preventDefault();
            return true;
          },
        },
      }),
  );
}
