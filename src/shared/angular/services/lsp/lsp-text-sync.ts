// Pure text-synchronisation helpers for the LSP client. Kept free of Angular and Monaco imports so
// the minimal-edit computation can be unit tested directly.

/**
 * A zero-based Language Server Protocol position.
 */
export interface LspSyncPosition {
  /**
   * Gets the zero-based line.
   */
  readonly line: number;

  /**
   * Gets the zero-based character offset within the line.
   */
  readonly character: number;
}

/**
 * A Language Server Protocol range within the previous document text.
 */
export interface LspSyncRange {
  /**
   * Gets the start position.
   */
  readonly start: LspSyncPosition;

  /**
   * Gets the end position.
   */
  readonly end: LspSyncPosition;
}

/**
 * A single ranged content change: the range of the previous text it replaces and the new text.
 */
export interface LspContentEdit {
  /**
   * Gets the range of the previous document text the edit replaces.
   */
  readonly range: LspSyncRange;

  /**
   * Gets the replacement text.
   */
  readonly text: string;
}

/**
 * Computes the smallest single ranged edit that turns one document text into another, by trimming the
 * common prefix and suffix. Editors mostly change one small span at a time, so this reduces the
 * per-keystroke `textDocument/didChange` payload from the whole document to the changed span —
 * which both shrinks the IPC traffic and lets incremental-sync servers (Roslyn, jdtls) re-analyse
 * only what changed. When the texts share nothing, the edit degenerates to a whole-document replace
 * (which still carries the explicit range that incremental-sync servers require).
 * @param oldText The previous document text (what the server currently holds).
 * @param newText The new document text.
 * @returns Returns the minimal edit, or null when the texts are identical.
 */
export function minimalReplaceEdit(oldText: string, newText: string): LspContentEdit | null {
  if (oldText === newText) {
    return null;
  }

  const maxPrefix: number = Math.min(oldText.length, newText.length);
  let prefix: number = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix += 1;
  }

  const maxSuffix: number = maxPrefix - prefix;
  let suffix: number = 0;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  // Never split a \r\n pair: a boundary between the \r and the \n would make the line/character
  // arithmetic disagree with a server that treats the pair as one terminator. Widen the changed
  // region instead.
  if (prefix > 0 && oldText.charAt(prefix - 1) === '\r' && oldText.charAt(prefix) === '\n') {
    prefix -= 1;
  }
  if (
    suffix > 0 &&
    oldText.charAt(oldText.length - suffix) === '\n' &&
    oldText.charAt(oldText.length - 1 - suffix) === '\r'
  ) {
    suffix -= 1;
  }

  return {
    range: {
      start: positionAt(oldText, prefix),
      end: positionAt(oldText, oldText.length - suffix),
    },
    text: newText.slice(prefix, newText.length - suffix),
  };
}

/**
 * Converts a character offset into a zero-based line/character position, counting `\n`, `\r\n` and
 * lone `\r` as line terminators (the three the Language Server Protocol recognises).
 * @param text The document text the offset indexes into.
 * @param offset The character offset (clamped to the text length).
 * @returns Returns the position of the offset.
 */
export function positionAt(text: string, offset: number): LspSyncPosition {
  const end: number = Math.min(offset, text.length);
  let line: number = 0;
  let character: number = 0;
  for (let index: number = 0; index < end; index += 1) {
    const char: string = text.charAt(index);
    if (char === '\n' || (char === '\r' && text.charAt(index + 1) !== '\n')) {
      line += 1;
      character = 0;
    } else if (char !== '\r') {
      character += 1;
    }
  }
  return { line, character };
}
