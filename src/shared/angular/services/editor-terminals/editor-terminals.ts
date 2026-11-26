import { inject, Service, signal, WritableSignal } from '@angular/core';
import { TabDocks } from '@shared/angular/services/dock-layout/tab-docks';
import { Log } from '@shared/angular/services/log/log';

/**
 * The identifier of a code tab's run-terminal panel in its dock.
 */
export const EDITOR_TERMINAL_PANEL_ID: string = 'terminal';

/**
 * Gets the identifier of a code tab's run-terminal session.
 * @param tabId The owning tab identifier.
 * @returns Returns the session's identifier.
 */
export function editorTerminalId(tabId: string): string {
  return `run-${tabId}`;
}

/**
 * Runs commands in code tabs' docked terminals: holds the command queued to run in each once its terminal
 * is ready, and opens its panel. The tab's dock is what knows whether the panel is open.
 */
@Service()
export class EditorTerminals {
  /**
   * Holds the command queued in each tab's terminal, by the tab's identifier.
   */
  private readonly queued: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());

  /**
   * Holds the tabs' docks, which the terminal's panel is opened in.
   */
  private readonly docks: TabDocks = inject(TabDocks);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Queues a command to run in a tab's terminal, opening its panel.
   * @param id The owning tab identifier.
   * @param command The command to run.
   */
  public queueCommand(id: string, command: string): void {
    this.queued.update((queued: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
      new Map<string, string>(queued).set(id, command),
    );
    this.docks.open(id, EDITOR_TERMINAL_PANEL_ID);
    this.log.info('EditorTerminals', `Queued terminal command`, id, command);
  }

  /**
   * Returns a tab's pending command without clearing it.
   * @param id The owning tab identifier.
   * @returns Returns the pending command, or null when none is queued.
   */
  public pending(id: string): string | null {
    return this.queued().get(id) ?? null;
  }

  /**
   * Returns and clears a tab's pending command.
   * @param id The owning tab identifier.
   * @returns Returns the pending command, or null when none is queued.
   */
  public takePending(id: string): string | null {
    const pending: string | null = this.pending(id);
    if (pending !== null) {
      this.remove(id);
    }
    return pending;
  }

  /**
   * Forgets a tab's pending command. Called when the tab closes.
   * @param id The owning tab identifier.
   */
  public remove(id: string): void {
    this.queued.update(
      (queued: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
        new Map<string, string>(
          [...queued].filter(([other]: readonly [string, string]): boolean => other !== id),
        ),
    );
  }
}
