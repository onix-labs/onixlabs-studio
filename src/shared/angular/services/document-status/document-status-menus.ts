import type { MenuItem } from '@shared/angular/components/menu/menu';
import {
  encodingLabel,
  isTextEncoding,
  TEXT_ENCODINGS,
  type TextEncoding,
} from '@shared/api/text-encodings';
import type { DocumentStatusActions } from './document-status';

/**
 * Holds the line endings a document can be converted to.
 */
const LINE_ENDINGS: readonly ('LF' | 'CRLF')[] = ['LF', 'CRLF'];

/**
 * Builds the end-of-line menu a status strip opens: LF and CRLF, the document's own marked.
 * @param current The document's line ending.
 * @returns Returns the rows.
 */
export function eolMenuItems(current: string | undefined): readonly MenuItem[] {
  return LINE_ENDINGS.map((eol: 'LF' | 'CRLF'): MenuItem => ({
    id: eol,
    label: eol === 'LF' ? 'LF (Unix and macOS)' : 'CRLF (Windows)',
    active: current === eol,
  }));
}

/**
 * Converts a document's line endings as an end-of-line row says.
 * @param id The chosen row.
 * @param actions What the document can do.
 */
export function chooseEol(id: string, actions: DocumentStatusActions | undefined): void {
  if (id === 'LF' || id === 'CRLF') {
    actions?.setEol?.(id);
  }
}

/**
 * Builds the encoding menu a status strip opens: Reopen with Encoding and Save with Encoding, each
 * listing the encodings, as far as the document can do either.
 * @param actions What the document can do.
 * @returns Returns the rows, or none when the document can do neither.
 */
export function encodingMenuItems(actions: DocumentStatusActions | undefined): readonly MenuItem[] {
  const list: (prefix: string) => readonly MenuItem[] = (prefix: string): readonly MenuItem[] =>
    TEXT_ENCODINGS.map((encoding: TextEncoding): MenuItem => ({
      id: `${prefix}:${encoding}`,
      label: encodingLabel(encoding),
    }));
  return [
    ...(actions?.reopenWithEncoding === undefined
      ? []
      : [{ id: 'reopen', label: 'Reopen with Encoding', children: list('reopen') }]),
    ...(actions?.saveWithEncoding === undefined
      ? []
      : [{ id: 'save', label: 'Save with Encoding', children: list('save') }]),
  ];
}

/**
 * Reopens or saves a document in an encoding as an encoding row says.
 * @param id The chosen row: `reopen:` or `save:`, then the encoding.
 * @param actions What the document can do.
 */
export function chooseEncoding(id: string, actions: DocumentStatusActions | undefined): void {
  const [action, encoding] = id.split(':');
  if (!isTextEncoding(encoding)) {
    return;
  }
  if (action === 'reopen') {
    actions?.reopenWithEncoding?.(encoding);
  } else if (action === 'save') {
    actions?.saveWithEncoding?.(encoding);
  }
}
