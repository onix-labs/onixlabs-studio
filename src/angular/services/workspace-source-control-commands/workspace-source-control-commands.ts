import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Defines the lightweight source-control commands the directory (workspace) ribbon can invoke on the
 * active workspace. The workspace surfaces only the everyday operations — open the repository in the
 * full source-control view, commit, push, and pull — while the source-control tab carries the rest.
 */
export interface WorkspaceSourceControlCommandHandler {
  /**
   * Gets whether the active workspace's open folder is a git repository, so the ribbon can disable its
   * source-control actions when there is nothing to act on.
   */
  readonly hasRepository: Signal<boolean>;

  /**
   * Opens the workspace's repository in the full source-control view (a new tab).
   */
  openInSourceControl(): void;

  /**
   * Reveals the workspace's commit panel so staged changes can be committed.
   */
  commit(): void;

  /**
   * Pushes the workspace's current branch to its upstream.
   */
  push(): void;

  /**
   * Pulls the workspace's current branch from its upstream.
   */
  pull(): void;
}

/**
 * Routes the directory ribbon's source-control commands to the active workspace.
 *
 * The active directory view registers its handler here; the ribbon buttons call the matching method,
 * which forwards to the registered handler (or does nothing when no directory tab is active). This is
 * the workspace twin of {@link import('../source-control-commands/source-control-commands').SourceControlCommands}.
 */
@Service()
export class WorkspaceSourceControlCommands {
  /**
   * Holds the active workspace's command handler, or null when no directory tab is active.
   */
  private readonly handler: WritableSignal<WorkspaceSourceControlCommandHandler | null> =
    signal<WorkspaceSourceControlCommandHandler | null>(null);

  /**
   * Gets whether the active workspace is a git repository, so the ribbon can enable its actions.
   */
  public readonly hasRepository: Signal<boolean> = computed(
    (): boolean => this.handler()?.hasRepository() ?? false,
  );

  /**
   * Registers the active workspace's command handler.
   * @param handler The handler to register.
   */
  public register(handler: WorkspaceSourceControlCommandHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given command handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: WorkspaceSourceControlCommandHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Opens the active workspace's repository in the full source-control view.
   */
  public openInSourceControl(): void {
    this.handler()?.openInSourceControl();
  }

  /**
   * Reveals the active workspace's commit panel.
   */
  public commit(): void {
    this.handler()?.commit();
  }

  /**
   * Pushes the active workspace's current branch.
   */
  public push(): void {
    this.handler()?.push();
  }

  /**
   * Pulls the active workspace's current branch.
   */
  public pull(): void {
    this.handler()?.pull();
  }
}
