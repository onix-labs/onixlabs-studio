import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';

/**
 * Hosts an interactive terminal as a dockable IDE panel for a workspace or repository tab. It embeds
 * the shared {@link Terminal} pane, keying the PTY session by the owning tab and rooting the shell at
 * the tab's folder (or repository root). The session is created once the root is known, so a tab with
 * no folder open shows a prompt instead of spawning a shell in the wrong directory.
 */
@Component({
  selector: 'app-terminal-panel',
  imports: [Terminal, AppIcon],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

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
