import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ShellInfo } from '@shared/api/terminal-channels';
import { Log } from '@shared/angular/services/log/log';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';

/**
 * Provides the list of shells installed on the host, shared by the terminal ribbon's shell picker and
 * the Settings default-shell control.
 *
 * The list is fetched once from the main process on construction and cached — the installed shells do
 * not change over a session — and exposed as a signal. Outside Electron the bridge yields an empty
 * list, so consumers simply see no shells to pick from.
 */
@Service()
export class TerminalShells {
  /**
   * Holds the terminal bridge the shell list is fetched through.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the cached shell list, empty until the first fetch resolves.
   */
  private readonly shellList: WritableSignal<readonly ShellInfo[]> = signal<readonly ShellInfo[]>(
    [],
  );

  /**
   * Gets the shells installed on the host, most-preferred first.
   */
  public readonly shells: Signal<readonly ShellInfo[]> = this.shellList.asReadonly();

  /**
   * Initialises the service, fetching the installed shells once.
   */
  public constructor() {
    void this.load();
  }

  /**
   * Fetches the installed shells from the main process and caches them.
   */
  private async load(): Promise<void> {
    const shells: readonly ShellInfo[] = await this.bridge.listShells();
    this.shellList.set(shells);
    this.log.debug('TerminalShells', 'Loaded installed shells', shells.length);
  }
}
