import { Directive, inject, input, InputSignal } from '@angular/core';
import { Panel } from './panel';
import { PanelLayoutDrag } from './panel-layout-drag';
import { PanelRect } from './panel-types';

/**
 * Marks an element — typically a panel's header bar — as the handle that drags its panel onto
 * another edge of the owning {@link PanelLayout}. The directive resolves the panel and the
 * layout's drag coordinator from the injector hierarchy, so it is inert (a plain element) when the
 * host component is used outside a panel layout, such as inside the dock.
 *
 * Interactive children keep working: a press on a button, link or form field never starts a drag,
 * and a press below the drag threshold stays a click.
 */
@Directive({
  selector: '[appPanelDragHandle]',
  host: {
    '[style.cursor]': "draggable ? 'grab' : null",
    '(mousedown)': 'onMouseDown($event)',
  },
})
export class PanelDragHandle {
  /**
   * Holds the panel the handle drags, or null when the host is outside a panel.
   */
  private readonly panel: Panel | null = inject(Panel, { optional: true });

  /**
   * Holds the owning layout's drag coordinator, or null when the host is outside a layout.
   */
  private readonly drag: PanelLayoutDrag | null = inject(PanelLayoutDrag, { optional: true });

  /**
   * Gets the title shown on the drag ghost. Falls back to the panel's identifier when empty.
   */
  public readonly dragTitle: InputSignal<string> = input<string>('', {
    alias: 'appPanelDragHandle',
  });

  /**
   * Gets a value indicating whether the handle can start a drag: both the panel and the layout's
   * drag coordinator resolved.
   */
  protected get draggable(): boolean {
    return this.panel !== null && this.drag !== null;
  }

  /**
   * Arms a panel drag, unless the press is not a primary-button press on the handle's own surface.
   * @param event The mouse-down event.
   */
  protected onMouseDown(event: MouseEvent): void {
    if (this.panel === null || this.drag === null || event.button !== 0) {
      return;
    }
    const target: HTMLElement | null = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, [contenteditable="true"]') !== null) {
      return;
    }
    const rect: DOMRect = this.panel.hostElement.getBoundingClientRect();
    const source: PanelRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const title: string = this.dragTitle() !== '' ? this.dragTitle() : this.panel.panelId();
    this.drag.begin(this.panel.panelId(), title, source, event);
  }
}
