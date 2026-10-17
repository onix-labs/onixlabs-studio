import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { CloneChannel, CloneClient, CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * The renderer client for cloning a repository into a new folder (#805): a thin, typed wrapper over
 * the {@link Bridge} naming the {@link CloneChannel} channels. Where clones go is chosen in the main
 * process's own dialog; this can read it and ask to change it, but never set it.
 */
@Service()
export class Clone implements CloneClient {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets a value indicating whether cloning is possible at all.
   */
  public readonly isAvailable: boolean = window.bridge !== undefined;

  /**
   * Gets the folder clones go into.
   * @returns Returns its absolute path, or null when none is chosen.
   */
  public parent(): Promise<string | null> {
    return this.bridge?.invoke<string | null>(CloneChannel.Parent) ?? Promise.resolve(null);
  }

  /**
   * Asks the user to choose the folder clones go into.
   * @returns Returns the chosen folder, or null when the dialog was cancelled.
   */
  public pickParent(): Promise<string | null> {
    return this.bridge?.invoke<string | null>(CloneChannel.PickParent) ?? Promise.resolve(null);
  }

  /**
   * Clones a repository into the chosen folder.
   * @param request The clone to make.
   * @returns Returns where the result is, or why there is none.
   */
  public clone(request: CloneRequest): Promise<CloneOutcome> {
    this.log.info('clone', `Cloning ${request.url} as ${request.name} (${request.layout})`);
    return (
      this.bridge?.invoke<CloneOutcome>(CloneChannel.Clone, request) ??
      Promise.resolve({
        ok: false,
        error: 'Cloning is unavailable outside the desktop application.',
      })
    );
  }
}
