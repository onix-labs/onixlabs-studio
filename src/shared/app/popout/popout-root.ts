import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { WindowControls } from '@shared/angular/components/strips/title-strip/window-controls/window-controls';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { parsePopoutSearch } from '@shared/api/popout-params';
import { TerminalPopoutPanel } from './terminal-popout-panel';

/**
 * Represents the pop-out window's root: a minimal shell with its own title bar (the draggable
 * region, plus the custom window controls on platforms that need them) around a single hosted
 * surface. Closing the window IS the dock-back gesture — the owner returns the hosted panel to the
 * workspace dock when the window goes away — so the title bar carries no extra controls.
 *
 * The surface is chosen by the pop-out's `panel` parameter: `terminal` hosts the workspace's
 * mirrored terminal panel; without a parameter the window hosts a scratch shell owned by this
 * window alone (the development surface the fabric was proven on).
 */
@Component({
  selector: 'app-root',
  imports: [Terminal, TerminalPopoutPanel, WindowControls],
  templateUrl: './popout-root.html',
  styleUrl: './popout-root.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopoutRoot {
  /**
   * Holds the terminal bridge, used to dispose the scratch session when the window goes away.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Gets the window title, from the pop-out parameters.
   */
  protected readonly title: string;

  /**
   * Gets the hosted surface selector from the pop-out parameters, or null for the scratch shell.
   */
  protected readonly panelKind: string | null;

  /**
   * Gets the identifier of the scratch shell session this window hosts (scratch mode only).
   */
  protected readonly scratchId: string;

  /**
   * Initializes a new instance of the {@link PopoutRoot} class, reading the pop-out parameters the
   * window was opened with.
   */
  public constructor() {
    const params: Record<string, string> = parsePopoutSearch(window.location.search) ?? {};
    this.title = params['title'] ?? 'Studio';
    this.panelKind = params['panel'] ?? null;
    this.scratchId = `popout-scratch-${params['scratch'] ?? crypto.randomUUID()}`;
    document.title = this.title;
    if (this.panelKind === null) {
      // The scratch shell belongs to this window alone, so it dies with it. Angular destroy hooks
      // do not run when a window closes, so the disposal rides the unload instead. A mirrored panel
      // has no such teardown: its sessions belong to the workspace window and must survive.
      window.addEventListener('beforeunload', (): void => {
        void this.bridge.dispose(this.scratchId);
      });
    }
  }
}
