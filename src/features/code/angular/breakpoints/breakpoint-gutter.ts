import { inject, OnDestroy, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { BreakpointGutterController } from './breakpoint-gutter-controller';

/**
 * Creates and tracks {@link BreakpointGutterController} instances so a breakpoint gutter can be attached
 * to a Monaco editor with the Monaco namespace resolved centrally, and so every controller is torn down
 * when the application shuts down. Mirrors {@link
 * import('../change-margin/change-margins').ChangeMargins}; the component that owns an editor attaches a
 * controller, keeps it, and drives its rendering and disposal from its own lifecycle.
 */
@Service()
export class BreakpointGutter implements OnDestroy {
  /**
   * Holds the Monaco service supplying the namespace controllers build decorations with.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the live controllers, so all are disposed if the service is destroyed.
   */
  private readonly controllers: Set<BreakpointGutterController> =
    new Set<BreakpointGutterController>();

  /**
   * Attaches a breakpoint-gutter controller to an editor. Returns null when Monaco has not loaded yet,
   * in which case no gutter is drawn.
   * @param editor The editor to draw breakpoint glyphs in.
   * @param onToggle Reports a toggle request for a 1-based line.
   * @param onEdit Reports an edit request for a 1-based line.
   * @returns Returns the controller, or null when Monaco is unavailable.
   */
  public attach(
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    onToggle: (line: number) => void,
    onEdit: (line: number) => void,
  ): BreakpointGutterController | null {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return null;
    }
    const controller: BreakpointGutterController = new BreakpointGutterController(
      monaco,
      editor,
      onToggle,
      onEdit,
    );
    this.controllers.add(controller);
    return controller;
  }

  /**
   * Detaches and disposes a controller previously returned by {@link attach}.
   * @param controller The controller to detach.
   */
  public detach(controller: BreakpointGutterController): void {
    if (this.controllers.delete(controller)) {
      controller.dispose();
    }
  }

  /**
   * Disposes every tracked controller when the service is destroyed.
   */
  public ngOnDestroy(): void {
    for (const controller of this.controllers) {
      controller.dispose();
    }
    this.controllers.clear();
  }
}
