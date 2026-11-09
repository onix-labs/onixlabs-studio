import { DOCUMENT, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type { Bridge } from '@shared/api/bridge';
import { WindowChannel } from '@shared/api/window-channels';

/**
 * Follows whether the main window is in full screen, as the main process reports it, and marks the
 * document root with `data-full-screen` so the styles can follow too: macOS draws no traffic lights
 * over a full-screen window's title strip, so the strip stops leaving room for them.
 */
@Service()
export class FullScreen {
  /**
   * Holds the document the attribute is applied to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the backing state for {@link active}.
   */
  private readonly state: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the main window is in full screen.
   */
  public readonly active: Signal<boolean> = this.state.asReadonly();

  /**
   * Initializes the service, following the main process's reports. Inert outside Electron.
   */
  public constructor() {
    const bridge: Bridge | undefined = window.bridge;
    bridge?.on(WindowChannel.FullScreenChanged, (fullScreen: unknown): void => {
      const active: boolean = fullScreen === true;
      this.state.set(active);
      if (active) {
        this.document.documentElement.setAttribute('data-full-screen', 'true');
      } else {
        this.document.documentElement.removeAttribute('data-full-screen');
      }
    });
  }
}
