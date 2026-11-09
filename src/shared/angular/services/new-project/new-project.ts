import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  NewProjectChannel,
  NewProjectClient,
  NewProjectOutcome,
  NewProjectRequest,
  PickedDocuments,
} from '@shared/api/new-project-channels';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

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
   * Holds the settings store, for the Default Branch Name for New Repositories.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Creates a new project's folder in the chosen parent folder.
   * @param request The project to make.
   * @returns Returns where it is, or why there is none.
   */
  public create(request: NewProjectRequest): Promise<NewProjectOutcome> {
    this.log.info('new-project', `Creating ${request.name} (${request.repository.kind})`);
    const defaultBranch: string = this.settings.get('versionControl.defaultBranchName').trim();
    const sent: NewProjectRequest =
      defaultBranch.length > 0 && request.defaultBranch === undefined
        ? { ...request, defaultBranch }
        : request;
    return (
      this.bridge?.invoke<NewProjectOutcome>(NewProjectChannel.Create, sent) ??
      Promise.resolve({
        ok: false,
        error: 'Creating a project is unavailable outside the desktop application.',
      })
    );
  }

  /**
   * Gets the folder new projects are made in.
   * @returns Returns the folder, or null before one is known.
   */
  public defaultFolder(): Promise<string | null> {
    return this.bridge?.invoke<string | null>(NewProjectChannel.Parent) ?? Promise.resolve(null);
  }

  /**
   * Asks the user where this project goes, without changing the Default Projects Folder.
   * @returns Returns the folder chosen, or null when the dialog was cancelled.
   */
  public pickFolder(): Promise<string | null> {
    return (
      this.bridge?.invoke<string | null>(NewProjectChannel.PickParent) ?? Promise.resolve(null)
    );
  }

  /**
   * Asks the user for the Default Projects Folder.
   * @returns Returns the folder chosen, or null when the dialog was cancelled.
   */
  public pickDefaultFolder(): Promise<string | null> {
    return (
      this.bridge?.invoke<string | null>(NewProjectChannel.PickDefaultParent) ??
      Promise.resolve(null)
    );
  }

  /**
   * Asks the user for supporting documents and reads them.
   * @returns Returns what was read and what was left out; nothing when the dialog was cancelled.
   */
  public pickDocuments(): Promise<PickedDocuments> {
    return (
      this.bridge?.invoke<PickedDocuments>(NewProjectChannel.PickDocuments) ??
      Promise.resolve({ documents: [], skipped: [] })
    );
  }
}
