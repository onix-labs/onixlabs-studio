import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { CloneChannel, CloneClient, CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Log } from '@shared/angular/services/log/log';
import { CoreNotificationType } from '@shared/angular/services/notifications/core-notification-types';
import { Notifications } from '@shared/angular/services/notifications/notifications';

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
   * Holds the notification store a finished clone is reported to (#1493).
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the opener a finished clone's Open action uses.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

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
   * Clones a repository into the chosen folder, and reports how it ended (#1493): a large clone takes
   * long enough that the user has gone elsewhere by the time it does.
   * @param request The clone to make.
   * @returns Returns where the result is, or why there is none.
   */
  public async clone(request: CloneRequest): Promise<CloneOutcome> {
    this.log.info('clone', `Cloning ${request.url} as ${request.name} (${request.layout})`);
    if (this.bridge === undefined) {
      return { ok: false, error: 'Cloning is unavailable outside the desktop application.' };
    }
    const outcome: CloneOutcome = await this.bridge.invoke<CloneOutcome>(
      CloneChannel.Clone,
      request,
    );
    this.notifyOutcome(request.name, outcome);
    return outcome;
  }

  /**
   * Raises a finished clone's notification: Cloned, with Open, or Couldn't Clone, with the reason.
   * Both pop up, and reach the desktop while Studio is in the background.
   * @param name The repository's name.
   * @param outcome How the clone ended.
   */
  private notifyOutcome(name: string, outcome: CloneOutcome): void {
    if (outcome.ok) {
      const open: () => void = (): void => void this.fileOpener.openDirectoryPath(outcome.path);
      this.notifications.notify({
        severity: 'success',
        title: `Cloned ${name}`,
        detail: outcome.path,
        actions: [{ label: 'Open', run: open }],
        key: `clone:${name}`,
        type: CoreNotificationType.CloneFinished,
        desktop: true,
        reveal: open,
      });
      return;
    }
    this.notifications.notify({
      severity: 'error',
      title: `Couldn't clone ${name}`,
      detail: outcome.error,
      key: `clone:${name}`,
      sticky: true,
      type: CoreNotificationType.CloneFailed,
      desktop: true,
    });
  }
}
