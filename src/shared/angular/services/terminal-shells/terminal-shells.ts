import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ShellInfo } from '@shared/api/terminal-channels';
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
   * Resolves the display name for a shell path, using the enumerated list when the path is known and
   * falling back to the path's base name otherwise (so a shell no longer listed still reads sensibly).
   * @param shellPath The absolute shell path.
   * @returns Returns the shell's display name.
   */
  public nameOf(shellPath: string): string {
    const known: ShellInfo | undefined = this.shellList().find(
      (shell: ShellInfo): boolean => shell.path === shellPath,
    );
    if (known !== undefined) {
      return known.name;
    }
    const base: string = shellPath.split(/[\\/]/).pop() ?? shellPath;
    return base.replace(/\.[^.]+$/, '');
  }

  /**
   * Fetches the installed shells from the main process and caches them.
   */
  private async load(): Promise<void> {
    this.shellList.set(await this.bridge.listShells());
  }
}
