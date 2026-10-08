import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  NewProjectChannel,
  NewProjectClient,
  NewProjectOutcome,
  NewProjectRequest,
} from '@shared/api/new-project-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * The renderer client for creating a new project from the welcome screen (#806): a thin, typed wrapper
 * over the {@link Bridge} naming the {@link NewProjectChannel} channel. The project is made where clones
 * go, which only the main process's own dialog can choose.
 */
@Service()
export class NewProject implements NewProjectClient {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Creates a new project's folder in the chosen parent folder.
   * @param request The project to make.
   * @returns Returns where it is, or why there is none.
   */
  public create(request: NewProjectRequest): Promise<NewProjectOutcome> {
    this.log.info('new-project', `Creating ${request.name} (${request.repository.kind})`);
    return (
      this.bridge?.invoke<NewProjectOutcome>(NewProjectChannel.Create, request) ??
      Promise.resolve({
        ok: false,
        error: 'Creating a project is unavailable outside the desktop application.',
      })
    );
  }
}
