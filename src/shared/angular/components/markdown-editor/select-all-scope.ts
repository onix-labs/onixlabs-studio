import type { SelectAllScope } from '@shared/angular/services/settings/settings';

/**
 * Decides whether a Select All chord targets the whole document rather than the current block. The
 * plain chord (Cmd/Ctrl+A) targets the configured primary scope; the Shift chord (Cmd/Ctrl+Shift+A)
 * targets the other one.
 * @param primary The configured primary scope for the plain chord.
 * @param shift Whether the Shift modifier is held (the secondary chord).
 * @returns Returns true to select the whole document, false to select the current block.
 */
export function selectAllTargetsDocument(primary: SelectAllScope, shift: boolean): boolean {
  return shift ? primary === 'block' : primary === 'document';
}
