import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Holds the identifier of the terminal address (its prompt title) status segment.
 */
const ADDRESS_SEGMENT_ID: string = 'terminal-address';

/**
 * Holds the identifier of the terminal-type (shell) status segment.
 */
const SHELL_SEGMENT_ID: string = 'terminal-shell';

/**
 * Holds the status-bar owner identifier for the terminal's contribution.
 */
const STATUS_OWNER: string = 'terminal';

/**
 * Holds the status-bar priority for the terminal, ordering its trailing shell segment after the code
 * editor's cursor/encoding segments.
 */
const STATUS_PRIORITY: number = 20;

/**
 * Describes the contextual information the active terminal publishes to the status strip.
 */
export interface TerminalContext {
  /**
   * Gets the terminal's address (its full prompt title, e.g. `user@host:~/path`), or null when the
   * shell has not yet reported one.
   */
  readonly address: string | null;

  /**
   * Gets the terminal's shell name (its terminal type), or null when it is not yet known.
   */
  readonly shell: string | null;
}

/**
 * Publishes the active terminal's address (its full prompt title, e.g. `user@host:~/path`) and shell
 * (its terminal type) to the status strip.
 *
 * The active terminal pushes its context here; an effect projects the address as a leading segment
 * and the shell as a trailing segment, clearing the contribution when no terminal is active. The
 * publishing tab is tracked so a deactivating terminal only clears the strip when it still owns it —
 * never wiping out the terminal that just became active (which would otherwise leave a stale
 * contribution lingering as tabs are switched).
 */
@Service()
export class TerminalStatus {
  /**
   * Holds the status bar the terminal segments are published to.
   */
  private readonly statusBar: StatusBar = inject(StatusBar);

  /**
   * Holds the active terminal's context and the tab that published it, or null when no terminal is
   * active. The tab is tracked so a deactivating terminal only clears the strip when it still owns it.
   */
  private readonly contextSignal: WritableSignal<{
    tabId: string;
    context: TerminalContext;
  } | null> = signal<{ tabId: string; context: TerminalContext } | null>(null);

  /**
   * Initializes the service, projecting the address as a leading segment and the shell as a trailing
   * segment.
   */
  public constructor() {
    effect((): void => {
      const current: { tabId: string; context: TerminalContext } | null = this.contextSignal();
      if (current === null) {
        this.statusBar.clearOwner(STATUS_OWNER);
        return;
      }
      const context: TerminalContext = current.context;
      this.statusBar.contribute(
        STATUS_OWNER,
        {
          leading:
            context.address === null ? [] : [{ id: ADDRESS_SEGMENT_ID, text: context.address }],
          trailing:
            context.shell === null
              ? []
              : [{ id: SHELL_SEGMENT_ID, text: context.shell, icon: Icon.TERMINAL }],
        },
        STATUS_PRIORITY,
      );
    });
  }

  /**
   * Publishes the given tab's terminal context as the active status.
   * @param tabId The identifier of the publishing tab.
   * @param context The terminal context (its address and shell).
   */
  public publish(tabId: string, context: TerminalContext): void {
    this.contextSignal.set({ tabId, context });
  }

  /**
   * Clears the status, but only when the given tab is the one currently shown, so a deactivating
   * terminal never wipes out the terminal that just became active.
   * @param tabId The identifier of the deactivating tab.
   */
  public clear(tabId: string): void {
    if (this.contextSignal()?.tabId === tabId) {
      this.contextSignal.set(null);
    }
  }
}
