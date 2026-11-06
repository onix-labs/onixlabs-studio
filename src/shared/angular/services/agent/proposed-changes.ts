import { Service } from '@angular/core';
import type { AiProposedChange } from '@shared/api/ai-types';
import {
  applyReplacements,
  fragmentDiff,
  ProposedDiff,
  proposedDiff,
} from '@shared/angular/components/agent-cards/agent-edit-diff/proposed-diff';

/**
 * Works out the diff a permission prompt shows for a change an agent proposes to a file (#891): the
 * file as it is now, against the file as the change would leave it.
 *
 * A write is diffed against the file, or against nothing when it does not exist yet. An edit is applied
 * to the file as the agent's own tool would apply it; when its text is no longer in the file, the
 * replaced text alone is shown, since where it would land cannot be said.
 *
 * The file as it is now comes with the change: the main process read it, because a path a model chose
 * is not one the renderer may read (#1174).
 */
@Service()
export class ProposedChanges {
  /**
   * Works out the diff for a proposed change.
   * @param change The change.
   * @returns Returns the diff.
   */
  public diffOf(change: AiProposedChange): Promise<ProposedDiff> {
    return new Promise<ProposedDiff>((resolve: (diff: ProposedDiff) => void): void =>
      resolve(this.work(change)),
    );
  }

  /**
   * Works out the diff, which a change too large to compare fails.
   * @param change The change.
   * @returns Returns the diff.
   */
  private work(change: AiProposedChange): ProposedDiff {
    const original: string | null = change.original ?? null;
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
