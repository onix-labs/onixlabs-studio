import type { Node as ProseMirrorNode, NodeType } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { $Prose } from '@milkdown/utils';
import type {
  MarkdownDefaultPaste,
  MarkdownRichPaste,
} from '@shared/angular/services/settings/settings-registry';

/**
 * Holds the elements Basic Only keeps: emphasis, links, lists and headings, plus the blocks that
 * separate them.
 */
const BASIC_TAGS: ReadonlySet<string> = new Set<string>([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'ul',
]);

/**
 * Plugin key for the Basic Only paste filter.
 */
const basicPasteKey: PluginKey = new PluginKey('basic-rich-paste');

/**
 * Reduces pasted HTML to its basic formatting: every other element gives way to its contents, and
 * every attribute but a link's address goes.
 * @param html The pasted HTML fragment.
 * @returns Returns the reduced HTML.
 */
export function keepBasicFormatting(html: string): string {
  const parsed: Document = new DOMParser().parseFromString(html, 'text/html');
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    if (!BASIC_TAGS.has(element.tagName.toLowerCase())) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    const href: string | null = element.tagName === 'A' ? element.getAttribute('href') : null;
    for (const name of element.getAttributeNames()) {
      element.removeAttribute(name);
    }
    if (href !== null) {
      element.setAttribute('href', href);
    }
  }
  return parsed.body.innerHTML;
}

/**
 * The plugin that applies Basic Only to a rich paste, ahead of the paste's parsing.
 */
export const basicRichPastePlugin: $Prose = $prose(
  (): Plugin =>
    new Plugin({
      key: basicPasteKey,
      props: { transformPastedHTML: (html: string): string => keepBasicFormatting(html) },
    }),
);

/**
 * Pastes clipboard text as the Default Paste setting says. A paste that keeps its rich formatting, or
 * text read as Markdown, is left to the editor's own paste.
 * @param view The editor view.
 * @param clipboard The clipboard's contents.
 * @param defaultPaste The Default Paste setting.
 * @param richPaste The Rich Paste Formatting setting.
 * @returns Returns true when the paste was handled here.
 */
export function pasteClipboardText(
  view: EditorView,
  clipboard: DataTransfer,
  defaultPaste: MarkdownDefaultPaste,
  richPaste: MarkdownRichPaste,
): boolean {
  if (view.state.selection.$from.parent.type.spec.code === true) {
    return false;
  }
  const text: string = clipboard.getData('text/plain');
  const rich: boolean = clipboard.getData('text/html').length > 0;
  if (text.length === 0 || (rich && richPaste !== 'none')) {
    return false;
  }
  if (rich && defaultPaste === 'markdown') {
    // With the formatting dropped, what's left pastes as the text it is.
    return view.pasteText(text);
  }
  if (defaultPaste === 'markdown') {
    return false;
  }
  if (defaultPaste === 'plain') {
    view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    return true;
  }
  const codeBlock: NodeType | undefined = view.state.schema.nodes['code_block'];
  if (codeBlock === undefined) {
    return false;
  }
  const block: ProseMirrorNode = codeBlock.create(null, view.state.schema.text(text));
  view.dispatch(view.state.tr.replaceSelectionWith(block).scrollIntoView());
  return true;
}

/**
 * Inserts an image into the document at a position.
 * @param view The editor view.
 * @param source The image's source.
 * @param alt The image's alt text.
 * @param position The position to insert at, or undefined for the selection.
 */
export function insertImage(
  view: EditorView,
  source: string,
  alt: string,
  position?: number,
): void {
  const type: NodeType | undefined =
    view.state.schema.nodes['image-block'] ?? view.state.schema.nodes['image'];
  if (type === undefined) {
    return;
  }
  const node: ProseMirrorNode =
    type.name === 'image' ? type.create({ src: source, alt }) : type.create({ src: source });
  view.dispatch(
    (position === undefined
      ? view.state.tr.replaceSelectionWith(node)
      : // The document may have shrunk while the image was being stored.
        view.state.tr.insert(Math.min(position, view.state.doc.content.size), node)
    ).scrollIntoView(),
  );
}

/**
 * Finds the image files in a clipboard or a drop.
 * @param transfer The clipboard or drop's contents.
 * @returns Returns the image files.
 */
export function imageFilesOf(transfer: DataTransfer): readonly File[] {
  return Array.from(transfer.files).filter((file: File): boolean => file.type.startsWith('image/'));
}
