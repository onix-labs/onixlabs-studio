import { inject, Service } from '@angular/core';
import type { AiProposedChange } from '@shared/api/ai-types';
import type { FileInfo } from '@shared/api/file-channels';
import {
  applyReplacements,
  fragmentDiff,
  ProposedDiff,
  proposedDiff,
} from '@shared/angular/components/agent-cards/agent-edit-diff/proposed-diff';
import { FileSystem } from '@shared/angular/services/file-system/file-system';

/**
 * Works out the diff a permission prompt shows for a change an agent proposes to a file (#891): the
 * file as it is now, against the file as the change would leave it.
 *
 * A write is diffed against the file, or against nothing when it does not exist yet. An edit is applied
 * to the file as the agent's own tool would apply it; when its text is no longer in the file, the
 * replaced text alone is shown, since where it would land cannot be said.
 */
@Service()
export class ProposedChanges {
  /**
   * Holds the file-system client the file is read through.
   */
  private readonly files: FileSystem = inject(FileSystem);

  /**
   * Works out the diff for a proposed change.
   * @param change The change.
   * @returns Returns the diff.
   */
  public async diffOf(change: AiProposedChange): Promise<ProposedDiff> {
    const read: FileInfo | null = await this.files.read(change.path).catch((): null => null);
    const original: string | null = read?.content ?? null;
    if (change.content !== undefined) {
      return proposedDiff(change.path, original, change.content);
    }
    const edits: NonNullable<AiProposedChange['edits']> = change.edits ?? [];
    const modified: string | null = applyReplacements(original ?? '', edits);
    return modified === null
      ? fragmentDiff(change.path, edits)
      : proposedDiff(change.path, original, modified);
  }
}
