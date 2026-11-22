import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  linkedSignal,
  output,
  OutputEmitterRef,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import type { BranchMerge } from '@shared/angular/services/repository/branch-merge';
import type { MergedBranch } from '@shared/angular/services/repository/merged-branch';

/**
 * Asks before Delete Merged Branches deletes anything (#887): it lists the local branches it will
 * delete, each with where its work went, and offers one checkbox to delete their copies on the remote
 * as well.
 *
 * ⛔ The checkbox starts unticked every time the dialog opens: deleting on the remote is for everyone
 * who works from it, so it is opted into, never carried over from the last time (ruling, 2026-11-21).
 * It is offered only for the remote branches that still exist, and only when the version-control
 * plugin can delete them.
 */
@Component({
  selector: 'app-delete-merged-branches',
  imports: [Modal, ModalContent, Button, ButtonRow, Checkbox],
  templateUrl: './delete-merged-branches.html',
  styleUrl: './delete-merged-branches.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteMergedBranches {
  /**
   * Gets the branches to delete, or null while the dialog is closed.
   */
  public readonly branches: InputSignal<readonly MergedBranch[] | null> = input<
    readonly MergedBranch[] | null
  >(null);

  /**
   * Gets whether the plugin can delete branches on a remote, which decides whether the checkbox is
   * offered at all.
   */
  public readonly canDeleteRemotes: InputSignal<boolean> = input<boolean>(true);

  /**
   * Emits when the user confirms, with whether to delete the remote branches too.
   */
  public readonly confirmed: OutputEmitterRef<boolean> = output<boolean>();

  /**
   * Emits when the user dismisses the dialog, deleting nothing.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Gets whether the dialog is open.
   */
  protected readonly open: Signal<boolean> = computed((): boolean => this.branches() !== null);

  /**
   * Gets the branches listed, with their reasons in words.
   */
  protected readonly rows: Signal<readonly DeleteMergedBranchesRow[]> = computed(
    (): readonly DeleteMergedBranchesRow[] =>
      (this.branches() ?? []).map((branch: MergedBranch): DeleteMergedBranchesRow => ({
        name: branch.name,
        reason: this.reasonOf(branch.merge),
      })),
  );

  /**
   * Gets how many local branches are deleted.
   */
  protected readonly count: Signal<number> = computed((): number => this.rows().length);

  /**
   * Gets the remote branches the checkbox would delete, as `origin/feature`: only those still on the
   * remote, and none when the plugin cannot delete them.
   */
  protected readonly remoteNames: Signal<readonly string[]> = computed((): readonly string[] =>
    this.canDeleteRemotes()
      ? (this.branches() ?? []).flatMap((branch: MergedBranch): readonly string[] =>
          branch.remoteBranch === undefined
            ? []
            : [`${branch.remoteBranch.remote}/${branch.remoteBranch.name}`],
        )
      : [],
  );

  /**
   * Gets how many remote branches the checkbox would delete.
   */
  protected readonly remoteCount: Signal<number> = computed(
    (): number => this.remoteNames().length,
  );

  /**
   * Gets the remote branches as one line, for the note beneath the checkbox.
   */
  protected readonly remoteList: Signal<string> = computed((): string =>
    this.remoteNames().join(', '),
  );

  /**
   * Holds whether the remote branches are deleted too. Reset to unticked whenever the branches change,
   * which is every time the dialog opens.
   */
  protected readonly includeRemotes: WritableSignal<boolean> = linkedSignal<
    readonly MergedBranch[] | null,
    boolean
  >({
    source: this.branches,
    computation: (): boolean => false,
  });

  /**
   * Confirms, deleting the branches, and the remote ones when ticked.
   */
  protected confirm(): void {
    this.confirmed.emit(this.remoteCount() > 0 && this.includeRemotes());
  }

  /**
   * Dismisses the dialog.
   */
  protected dismiss(): void {
    this.dismissed.emit();
  }

  /**
   * Words where a branch's work went, short enough to sit beside its name.
   * @param merge How it was merged.
   * @returns Returns the words.
   */
  private reasonOf(merge: BranchMerge): string {
    return merge.kind === 'local'
      ? $localize`:Beside a branch about to be deleted; it is already merged into the named default branch:merged into ${merge.into}:branch:`
      : $localize`:Beside a branch about to be deleted; its pull request was merged on the host:merged via pull request #${merge.number}:number:`;
  }
}

/**
 * Describes one branch the dialog lists.
 */
interface DeleteMergedBranchesRow {
  /**
   * Gets the branch's name.
   */
  readonly name: string;

  /**
   * Gets where its work went, in words.
   */
  readonly reason: string;
}
