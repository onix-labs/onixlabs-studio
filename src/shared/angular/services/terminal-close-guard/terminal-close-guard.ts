import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TerminalConfirmation } from '@shared/angular/services/terminal-confirmation/terminal-confirmation';
import type { TerminalOnShellExit } from '@shared/angular/services/settings/settings-registry';

/**
 * Decides whether a terminal closes when its shell exits, as When the Shell Exits says.
 * @param rule When the Shell Exits.
 * @param exitCode The code the shell exited with.
 * @param signal The signal that ended it, or null when it exited on its own.
 * @returns Returns true when the terminal closes.
 */
export function closesOnShellExit(
  rule: TerminalOnShellExit,
  exitCode: number,
  signal: number | null,
): boolean {
  return rule === 'close' || (rule === 'close-if-clean' && exitCode === 0 && signal === null);
}

/**
 * Asks before terminals close, as Confirm Before Closing a Running Terminal says: every time, only
 * while a program other than the shell runs in one, or never. Terminal tabs ask through the tab
 * closer; docked terminals through their panel.
 */
@Service()
export class TerminalCloseGuard {
  /**
   * Holds the settings the question is governed by.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the bridge that says what each terminal is running.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the dialog the question is asked in.
   */
  private readonly confirmation: TerminalConfirmation = inject(TerminalConfirmation);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Decides whether terminals may close, asking the user when the setting says to.
   * @param ids The terminals about to close.
   * @param name What the user calls the terminal, for the question: its tab's title.
   * @returns Resolves true when they may close.
   */
  public async mayClose(ids: readonly string[], name: string): Promise<boolean> {
    const mode: 'always' | 'running' | 'never' = this.settings.get('terminal.confirmClose');
    if (mode === 'never' || ids.length === 0) {
      return true;
    }
    const running: readonly string[] = (
      await Promise.all(ids.map((id: string): Promise<string | null> => this.bridge.foreground(id)))
    ).filter((program: string | null): program is string => program !== null);
    if (mode === 'running' && running.length === 0) {
      return true;
    }
    const confirmed: boolean = await this.confirmation.ask({
      title: 'Close Terminal?',
      body:
        running.length === 0
          ? `Close ${name}?`
          : `${running.join(', ')} ${running.length === 1 ? 'is' : 'are'} still running in ${name}. ` +
            'Closing the terminal stops it.',
      confirmLabel: 'Close',
    });
    this.log.info('TerminalCloseGuard', confirmed ? 'Close confirmed' : 'Close cancelled', name);
    return confirmed;
  }
}
