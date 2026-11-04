import { computed, effect, inject, Service, Signal, untracked } from '@angular/core';
import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { StartupSettings } from '@shared/api/startup-settings';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Mirrors the startup settings to the main process whenever they change: the settings it needs
 * before any window exists, or while none does (see `startup-settings.ts`). The main process persists
 * them beside its other startup preferences, so the next launch is shaped by them from the start.
 */
@Service()
export class StartupSettingsMirror {
  /**
   * Holds the settings store the startup settings live in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the transport to the main process, absent outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets the startup settings as the settings store holds them.
   */
  private readonly current: Signal<StartupSettings> = computed((): StartupSettings => ({
    quitWhenLastWindowCloses: this.settings.value('application.quitWhenLastWindowCloses')(),
    windowSizeOnLaunch: this.settings.value('application.windowSizeOnLaunch')(),
    restoreFullScreen: this.settings.value('application.restoreFullScreen')(),
    cornerStyle: this.settings.value('application.cornerStyle')(),
    confirmExternalLinks: this.settings.value('privacy.confirmExternalLinks')(),
    addStudioUserFileToGitignore: this.settings.value('workspaces.addStudioUserFileToGitignore')(),
    projectScanDepth: this.settings.value('workspaces.projectScanDepth')(),
    logFileSizeMb: this.settings.value('systemMonitor.logFileSizeMb')(),
    logRotatedCopies: this.settings.value('systemMonitor.logRotatedCopies')(),
    keepSessionLogsDays: this.settings.value('systemMonitor.keepSessionLogsDays')(),
    liveLogRecords: this.settings.value('systemMonitor.liveLogRecords')(),
    containerEngineAddress:
      this.settings.value('containers.engineAddressMode')() === 'custom'
        ? this.settings.value('containers.engineAddress')()
        : '',
  }));

  /**
   * Initializes the service, mirroring the settings now and on every change. The main process ignores
   * a mirror that changes nothing, so mirroring on every launch costs no write.
   */
  public constructor() {
    effect((): void => {
      const settings: StartupSettings = this.current();
      untracked((): void => {
        void this.bridge?.invoke(AppChannel.SetStartupSettings, settings);
      });
    });
  }
}
