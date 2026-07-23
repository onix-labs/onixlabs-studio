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
import { parsePopoutSearch } from '@shared/api/popout-params';

/**
 * Represents the pop-out window's root: a minimal shell with its own title bar (draggable region,
 * always-on-top pin, and the custom window controls on platforms that need them) around a single
 * hosted surface.
 *
 * For now the surface is a scratch shell terminal owned by this window alone — the proving ground
 * for the pop-out fabric (per-session output routing, theming, chrome). The terminal-panel pop-out
 * replaces it with the workspace's session strip in the next phase, at which point this content
 * region becomes a dock container.
 */
@Component({
  selector: 'app-root',
  imports: [AppIcon, Terminal, WindowControls],
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
   * Gets the window title, from the pop-out parameters.
   */
  protected readonly title: string;

  /**
   * Gets the identifier of the scratch shell session this window hosts.
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
    this.scratchId = `popout-scratch-${params['scratch'] ?? crypto.randomUUID()}`;
    document.title = this.title;
    // The scratch shell belongs to this window alone, so it dies with it. Angular destroy hooks do
    // not run when a window closes, so the disposal rides the unload instead.
    window.addEventListener('beforeunload', (): void => {
      void this.bridge.dispose(this.scratchId);
    });
  }

  /**
   * Toggles whether the window floats above every other window.
   */
  protected togglePin(): void {
    this.pinned.update((pinned: boolean): boolean => !pinned);
    this.studio.setWindowAlwaysOnTop(this.pinned());
  }
}
