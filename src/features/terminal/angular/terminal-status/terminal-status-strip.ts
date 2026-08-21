import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { TerminalContext, TerminalStatus } from './terminal-status';

/**
 * Shows the active terminal view's status: its address (the shell's full prompt title, for example
 * `user@host:~/path`) at the start of the strip, and its shell at the end.
 *
 * Mounted by the status strip through the active terminal view's injector, so it reads that view's
 * own {@link TerminalStatus}; it is destroyed when another tab is activated.
 */
@Component({
  selector: 'app-terminal-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalStatusStrip {
  /**
   * Holds the owning view's terminal context.
   */
  private readonly status: TerminalStatus = inject(TerminalStatus);

  /**
   * Gets the start-aligned segments: the terminal's address, once the shell reports one.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: TerminalContext | null = this.status.context();
      return context?.address == null ? [] : [{ id: 'terminal-address', text: context.address }];
    },
  );

  /**
   * Gets the end-aligned segments: the terminal's shell, once it is known.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const context: TerminalContext | null = this.status.context();
      return context?.shell == null
        ? []
        : [{ id: 'terminal-shell', text: context.shell, icon: Icon.TERMINAL }];
    },
  );
}
