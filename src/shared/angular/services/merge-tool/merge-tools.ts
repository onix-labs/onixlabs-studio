import { Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Asks an open merge tool to bring one of its conflicts into view: the Compare on a conflict's row in
 * the code editor, or the merge tool being opened on a particular conflict.
 */
export interface MergeToolReveal {
  /**
   * Gets the merge tool's panel identifier.
   */
  readonly panelId: string;

  /**
   * Gets the conflict's position in the file, counting from 0.
   */
  readonly index: number;

  /**
   * Gets a number that differs for every request, so asking for the same conflict twice is still
   * heard.
   */
  readonly sequence: number;
}

/**
 * Holds what each open merge tool shows (#1321): which file, by its panel, and the latest request to
 * bring a conflict into view.
 *
 * Kept apart from the opener, which names the panel's component, so the panel can read it without the
 * two importing each other — the same split as the diffs' store and their opener.
 */
@Service()
export class MergeTools {
  /**
   * Holds each merge tool's file, by its panel identifier.
   */
  private readonly paths: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Holds the latest request to bring a conflict into view, or null before any.
   */
  private readonly revealSignal: WritableSignal<MergeToolReveal | null> =
    signal<MergeToolReveal | null>(null);

  /**
   * Holds the number the next reveal request is given.
   */
  private nextSequence: number = 0;

  /**
   * Gets the latest request to bring a conflict into view.
   */
  public readonly reveal: Signal<MergeToolReveal | null> = this.revealSignal.asReadonly();

  /**
   * Gets the panel identifier of the merge tool for a file.
   * @param path The file's absolute path.
   * @returns Returns the identifier.
   */
  public idForPath(path: string): string {
    return `merge-tool:${path}`;
  }

  /**
   * Records which file a merge tool shows.
   * @param panelId The merge tool's panel identifier.
   * @param path The file's absolute path.
   */
  public put(panelId: string, path: string): void {
    if (this.paths().get(panelId) === path) {
      return;
    }
    this.paths.set(new Map<string, string>(this.paths()).set(panelId, path));
  }

  /**
   * Gets the file a merge tool shows. Reads a signal, so a computed that calls it follows it.
   * @param panelId The merge tool's panel identifier.
   * @returns Returns the file's absolute path, or null for a panel that is not a merge tool.
   */
  public pathOf(panelId: string): string | null {
    return this.paths().get(panelId) ?? null;
  }

  /**
   * Asks a merge tool to bring one of its conflicts into view.
   * @param panelId The merge tool's panel identifier.
   * @param index The conflict's position in the file, counting from 0.
   */
  public requestReveal(panelId: string, index: number): void {
    this.nextSequence += 1;
    this.revealSignal.set({ panelId, index, sequence: this.nextSequence });
  }
}
