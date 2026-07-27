import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Defines the repository commands the directory ribbon's Source Control group can invoke on the
 * active workspace.
 *
 * Deliberately small. Everything that acts on something the user can see and select — checking out a
 * branch, creating one, applying or dropping a stash, discarding a change, the diff layout — belongs
 * on the Repository and Commit panels, which reach their own {@link
 * import('../repository/repository').Repository} directly and need no seam. What is left here is the
 * repo-global remainder: fetching, stashing the whole working tree, and the structural promotion.
 */
export interface SourceControlCommandHandler {
  /**
   * Fetches from the remote without integrating.
   */
  fetch(): void;

  /**
   * Stashes the working-tree changes.
   */
  stash(): void;

  /**
   * Gets whether the view can promote its repository into a worktree container (an ordinary
   * single-repository workspace can; a checkout inside a container cannot).
   */
  readonly canPromoteToWorktree: Signal<boolean>;

  /**
   * Promotes the view's repository, in place, into a worktree container.
   */
  promoteToWorktree(): void;
}

/**
 * Routes source-control ribbon commands to the active repository view.
 *
 * The active source-control view registers its handler here; the ribbon buttons call the matching
 * method, which forwards to the registered handler (or does nothing when no source-control tab is
 * active).
 */
@Service()
export class SourceControlCommands {
  /**
   * Holds the active view's command handler, or null when no source-control tab is active.
   */
  private readonly handler: WritableSignal<SourceControlCommandHandler | null> =
    signal<SourceControlCommandHandler | null>(null);

  /**
   * Gets a value indicating whether a source-control view is currently active.
   */
  public readonly hasActiveRepository: Signal<boolean> = computed(
    (): boolean => this.handler() !== null,
  );

  /**
   * Registers the active view's command handler.
   * @param handler The handler to register.
   */
  public register(handler: SourceControlCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: SourceControlCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Invokes the fetch command on the active repository.
   */
  public fetch(): void {
    this.handler()?.fetch();
  }

  /**
   * Invokes the stash command on the active repository.
   */
  public stash(): void {
    this.handler()?.stash();
  }

  /**
   * Gets whether the active view can promote its repository into a worktree container.
   */
  public readonly canPromoteToWorktree: Signal<boolean> = computed(
    (): boolean => this.handler()?.canPromoteToWorktree() ?? false,
  );

  /**
   * Invokes the promote-to-worktree command on the active repository.
   */
  public promoteToWorktree(): void {
    this.handler()?.promoteToWorktree();
  }
}
