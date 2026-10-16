import DOMPurify from 'dompurify';

/**
 * The tags a raw HTML block from a markdown file may not carry into the document, on top of
 * everything DOMPurify drops by default (scripts, event handlers, `javascript:` URLs, frames).
 *
 * A markdown file is untrusted — it arrives with a clone — and the editor renders its HTML blocks
 * with `innerHTML`. The content-security policy stops script from running, but not these: a
 * `<meta http-equiv="refresh">` navigates the window the moment the block renders (Studio hands the
 * target to the browser), a `<style>` restyles the whole window rather than the block (it could cover
 * a permission card's Deny button), and a form or control invites typing that a submit then sends
 * away. None of them has a place in an image block, which is the only HTML the editor renders raw.
 */
const FORBIDDEN_TAGS: readonly string[] = [
  'style',
  'meta',
  'link',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
];

/**
 * Cleans a raw HTML block from a markdown document before it is rendered: what remains is markup
 * that can show an image and lay it out, and nothing that can run, navigate, restyle the window or
 * take input.
 * @param html The block's markup, as the document holds it.
 * @returns Returns the markup to render.
 */
export function sanitizeHtmlBlock(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: [...FORBIDDEN_TAGS] });
}
