import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  InputSignal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { Studio } from '@shared/angular/services/studio/studio';

/**
 * Holds how long, in milliseconds, the controls wait after the window stops resizing before asking
 * whether it is maximized. A drag-resize raises a stream of resize events; only where it settles
 * matters.
 */
const RESIZE_SETTLE_MS: number = 100;

/**
 * Represents a window's minimize, maximize/restore and close buttons, drawn by Studio where the
 * platform draws none: Linux, whose windows have no frame (see `WindowManager.chrome`). Elsewhere it
 * renders nothing, so a strip can always carry it.
 *
 * It acts on the window it is rendered in — the application window, or a pop-out or modal window the
 * application opened — found through the document it is injected with. A pop-out's or modal's host
 * provides that window's own document, so the same component serves every window.
 */
@Component({
  selector: 'app-window-controls',
  imports: [Button],
  templateUrl: './window-controls.html',
  styleUrl: './window-controls.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindowControls {
  /**
   * Gets a value indicating whether the window may be minimized. A modal window may not.
   */
  public readonly minimizable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the window may be maximized. A modal sized to its content, or
   * one with a size ceiling, may not.
   */
  public readonly maximizable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the window may be closed from its own chrome. A blocking modal
   * may not.
   */
  public readonly closable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the app-shell wrapper the buttons act through.
   */
  private readonly studio: Studio = inject(Studio);

  /**
   * Gets a value indicating whether the controls are drawn at all.
   */
  protected readonly visible: boolean = this.studio.drawsWindowControls;

  /**
   * Holds the window the controls act on: the one whose document they render in.
   */
  private readonly view: Window | null = inject(DOCUMENT).defaultView;

  /**
   * Gets a value indicating whether the window is maximized, which swaps maximize for restore.
   */
  protected readonly maximized: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Initializes a new instance of the {@link WindowControls} class. The maximized state is asked of
   * the main process whenever the window settles at a new size, so it stays right however the window
   * got there — these buttons, a double-click on the strip, or the window manager's own shortcuts.
   */
  public constructor() {
    const view: Window | null = this.view;
    if (!this.visible || view === null) {
      return;
    }
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onResize: () => void = (): void => {
      clearTimeout(settle);
      settle = setTimeout((): void => void this.refreshMaximized(), RESIZE_SETTLE_MS);
    };
    view.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy((): void => {
      clearTimeout(settle);
      view.removeEventListener('resize', onResize);
    });
    void this.refreshMaximized();
  }

  /**
   * Minimizes the window.
   */
  protected minimize(): void {
    if (this.view !== null) {
      this.studio.minimizeWindow(this.view);
    }
  }

  /**
   * Toggles the window between its maximized and restored states.
   */
  protected toggleMaximize(): void {
    if (this.view !== null) {
      this.studio.toggleMaximizeWindow(this.view);
    }
  }

  /**
   * Closes the window. The main process closes it exactly as the platform's own close button would,
   * so whatever guards a close (unsaved work in the application window, a modal's dismissal) runs.
   */
  protected close(): void {
    if (this.view !== null) {
      this.studio.closeWindow(this.view);
    }
  }

  /**
   * Asks the main process whether the window is maximized, and records the answer.
   */
  private async refreshMaximized(): Promise<void> {
    if (this.view !== null) {
      this.maximized.set(await this.studio.isWindowMaximized(this.view));
    }
  }
}
