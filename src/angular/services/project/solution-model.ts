import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ProjectApi } from '../../../shared/studio-api';
import { ProjectModel } from '../../../shared/project-system';
import { Workspace } from '../workspace/workspace';

/**
 * Holds the logical project model (the solution and its projects) for this tab's open workspace root,
 * fetched from the main process and refreshed whenever the root changes. Provided per directory tab so
 * each workspace tracks its own solution. The Solution Explorer renders this model, and the directory
 * view shows or hides that panel by whether the model is present. Outside Electron the bridge is
 * absent and the model stays null.
 */
@Service()
export class SolutionModel {
  /**
   * Holds this tab's workspace, whose root the model is built for.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the project-system bridge, or undefined when running outside Electron.
   */
  private readonly api: ProjectApi | undefined = window.studio?.project;

  /**
   * Holds the current model, or null when no root is open or none was recognised.
   */
  private readonly current: WritableSignal<ProjectModel | null> = signal<ProjectModel | null>(null);

  /**
   * Gets the current project model, or null when there is none.
   */
  public readonly model: Signal<ProjectModel | null> = this.current.asReadonly();

  /**
   * Initializes a new instance of the {@link SolutionModel} class, refreshing the model whenever the
   * open root changes.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      void this.refresh(root);
    });
  }

  /**
   * Loads the model for a root, clearing it when there is no root or bridge. A stale response (the root
   * changed again while the request was in flight) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once the model has been updated.
   */
  private async refresh(root: string | null): Promise<void> {
    if (this.api === undefined || root === null) {
      this.current.set(null);
      return;
    }
    const model: ProjectModel | null = await this.api.loadModel(root);
    if ((this.workspace.root()?.path ?? null) === root) {
      this.current.set(model);
    }
  }
}
