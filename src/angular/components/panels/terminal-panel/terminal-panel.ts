import { ChangeDetectionStrategy, Component, computed, inject, input, InputSignal, Signal } from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockTabContext } from '../../../services/dock/dock-tab-context';
import { TerminalView } from '../../views/terminal-view/terminal-view';

/**
 * Hosts an interactive terminal as a dockable IDE panel for a workspace or repository tab. It reuses
 * the shared {@link TerminalView}, keying the PTY session by the owning tab and rooting the shell at
 * the tab's folder (or repository root). The session is created once the root is known, so a tab with
 * no folder open shows a prompt instead of spawning a shell in the wrong directory.
 */
@Component({
  selector: 'app-terminal-panel',
  imports: [TerminalView],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanel {
  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet; the panel reads its
   * tab context from {@link DockTabContext} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the owning tab's context (its id and rooted folder).
   */
  private readonly context: DockTabContext = inject(DockTabContext);

  /**
   * Gets the absolute path the terminal's shell starts in, or null when no folder is open.
   */
  protected readonly root: Signal<string | null> = this.context.root;

  /**
   * Gets the terminal session's identifier, derived from the owning tab so it is globally unique.
   */
  protected readonly terminalId: Signal<string> = computed(
    (): string => `term-${this.context.tabId()}`,
  );
}
