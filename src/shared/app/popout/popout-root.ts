import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { WindowControls } from '@shared/angular/components/strips/title-strip/window-controls/window-controls';
import { Icon } from '@shared/angular/icons/icon';
import { Studio } from '@shared/angular/services/studio/studio';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { TerminalMirrorBridge } from '@shared/angular/services/terminal-mirror/terminal-mirror-bridge';
import { parsePopoutSearch } from '@shared/api/popout-params';
import { TerminalPopoutPanel } from './terminal-popout-panel';

/**
 * Represents the pop-out window's root: a minimal shell with its own title bar (draggable region,
 * always-on-top pin, and the custom window controls on platforms that need them) around a single
 * hosted surface.
 *
 * The surface is chosen by the pop-out's `panel` parameter: `terminal` hosts the workspace's
 * mirrored terminal panel (with a dock-back control in the title bar); without a parameter the
 * window hosts a scratch shell owned by this window alone (the development surface the fabric was
 * proven on).
 */
@Component({
  selector: 'app-root',
  imports: [AppIcon, Terminal, TerminalPopoutPanel, WindowControls],
  templateUrl: './popout-root.html',
  styleUrl: './popout-root.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopoutRoot {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the window-chrome bridge wrapper used to pin the window.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Holds the terminal bridge, used to dispose the scratch session when the window goes away.
   */
  private readonly bridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the mirror client, used to request docking the hosted panel back.
   */
  private readonly mirror: TerminalMirrorBridge = inject(TerminalMirrorBridge);

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
   * Gets a value indicating whether the window is pinned above every other window.
   */
  protected readonly pinned: WritableSignal<boolean> = signal<boolean>(false);

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

  /**
   * Toggles whether the window floats above every other window.
   */
  protected togglePin(): void {
    this.pinned.update((pinned: boolean): boolean => !pinned);
    this.studio.setWindowAlwaysOnTop(this.pinned());
  }

  /**
   * Asks the owner to dock the hosted panel back into the workspace (which closes this window).
   */
  protected dockBack(): void {
    this.mirror.sendAction({ kind: 'dock-back' });
  }
}
