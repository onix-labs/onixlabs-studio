import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Defines the commands the source-control ribbon can invoke on the active repository view.
 */
export interface SourceControlCommandHandler {
  /**
   * Re-reads the repository state (a mock refresh in the scaffold).
   */
  refresh(): void;

  /**
   * Fetches from the remote without integrating.
   */
  fetch(): void;

  /**
   * Pulls the current branch from its upstream.
   */
  pull(): void;

  /**
   * Pushes the current branch to its upstream.
   */
  push(): void;

  /**
   * Stages every unstaged change.
   */
  stageAll(): void;

  /**
   * Commits the staged changes.
   */
  commit(): void;

  /**
   * Stashes the working-tree changes.
   */
  stash(): void;

  /**
   * Starts a new branch from the current head.
   */
  newBranch(): void;

  /**
   * Toggles the diff between side-by-side and inline rendering.
   */
  toggleInlineDiff(): void;
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
   * Invokes the refresh command on the active repository.
   */
  public refresh(): void {
    this.handler()?.refresh();
  }

  /**
   * Invokes the fetch command on the active repository.
   */
  public fetch(): void {
    this.handler()?.fetch();
  }

  /**
   * Invokes the pull command on the active repository.
   */
  public pull(): void {
    this.handler()?.pull();
  }

  /**
   * Invokes the push command on the active repository.
   */
  public push(): void {
    this.handler()?.push();
  }

  /**
   * Invokes the stage-all command on the active repository.
   */
  public stageAll(): void {
    this.handler()?.stageAll();
  }

  /**
   * Invokes the commit command on the active repository.
   */
  public commit(): void {
    this.handler()?.commit();
  }

  /**
   * Invokes the stash command on the active repository.
   */
  public stash(): void {
    this.handler()?.stash();
  }

  /**
   * Invokes the new-branch command on the active repository.
   */
  public newBranch(): void {
    this.handler()?.newBranch();
  }

  /**
   * Invokes the toggle-inline-diff command on the active repository.
   */
  public toggleInlineDiff(): void {
    this.handler()?.toggleInlineDiff();
  }
}
