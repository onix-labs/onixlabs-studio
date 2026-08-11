import { ChangeDetectionStrategy, Component, inject, signal, WritableSignal } from '@angular/core';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { Ai } from '@shared/angular/services/ai/ai';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the remote-control mobile-push toggle in the AI settings section (#331). When on, Claude
 * Code pushes to the user's phone whenever a remote-controlled agent needs them — a permission prompt or
 * a question. This is Claude Code's account-level `inputNeededNotifEnabled` preference (Studio attaches
 * its own bridge worker, so a per-session SDK overlay would not reach it), surfaced here and read/written
 * through the main process. The toggle reflects nothing until the current value loads; outside Studio
 * (no bridge) it stays off and does nothing.
 */
@Component({
  selector: 'app-ai-remote-notifications',
  imports: [SettingRow, Toggle],
  templateUrl: './ai-remote-notifications.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiRemoteNotifications {
  /**
   * Holds the AI client the preference is read from and written through.
   */
  private readonly ai: Ai = inject(Ai);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether the mobile push is enabled, seeded from the persisted preference on construction.
   */
  protected readonly enabled: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Loads the current preference into the toggle.
   */
  public constructor() {
    void this.load();
  }

  /**
   * Persists a change to the preference and reflects it in the toggle immediately.
   * @param next Whether the push should be enabled.
   */
  protected onChange(next: boolean): void {
    this.enabled.set(next);
    this.log.info('settings.ai', 'Remote-control mobile push set', next);
    void this.ai.client?.setRemoteNotifications(next);
  }

  /**
   * Reads the persisted preference (no-op without a bridge), seeding the toggle.
   * @returns Resolves once the preference has loaded.
   */
  private async load(): Promise<void> {
    const current: boolean | undefined = await this.ai.client?.getRemoteNotifications();
    this.enabled.set(current ?? false);
  }
}
