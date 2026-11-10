import { DestroyRef, Directive, ElementRef, inject, output, OutputEmitterRef } from '@angular/core';

/**
 * Lets a `cdkMenuItem` act without closing the menu stack it belongs to.
 *
 * A CDK menu item closes every menu in its stack when chosen: its own click listener calls
 * `trigger()`, which ends in `closeAll()`, and nothing on the item can opt out — the only way in,
 * `trigger({ keepOpen: true })`, is reached by the space bar alone. That is right for a command, and
 * wrong for an item that edits the menu it sits in: Edit or Delete on a row of a menu has to leave
 * that menu open (#1420).
 *
 * This takes the click first, in the capture phase, and stops it there, so the item's own listener
 * never runs; the click is re-emitted for the host to act on, and the host closes what it wants
 * closed — usually only the submenu the item is in. Enter and the space bar on a `<button>` arrive as
 * native clicks (the CDK leaves those to the browser), so the keyboard goes the same way. The item
 * keeps everything else a menu item does: focus, arrow keys, type-ahead.
 */
@Directive({
  selector: '[appMenuKeepOpen]',
})
export class MenuKeepOpen {
  /**
   * Emitted when the item is chosen, in place of the menu item's own trigger.
   */
  public readonly appMenuKeepOpen: OutputEmitterRef<MouseEvent> = output<MouseEvent>();

  /**
   * Initializes a new instance of the {@link MenuKeepOpen} class, taking the host's clicks first.
   */
  public constructor() {
    const element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const take: (event: MouseEvent) => void = (event: MouseEvent): void => {
      // Capture listeners on the target run before its bubbling ones, so this beats the item's own.
      event.stopImmediatePropagation();
      event.preventDefault();
      this.appMenuKeepOpen.emit(event);
    };
    element.addEventListener('click', take, { capture: true });
    inject(DestroyRef).onDestroy((): void => {
      element.removeEventListener('click', take, { capture: true });
    });
  }
}
