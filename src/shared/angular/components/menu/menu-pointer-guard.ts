import { MENU_AIM, MenuAim } from '@angular/cdk/menu';
import { DestroyRef, Directive, forwardRef, inject, NgZone, Renderer2 } from '@angular/core';

/**
 * The pointer's position, in client coordinates.
 */
interface PointerPosition {
  /**
   * Gets the horizontal position.
   */
  readonly x: number;

  /**
   * Gets the vertical position.
   */
  readonly y: number;
}

/**
 * Holds a menu panel's hover-opening shut until the pointer has actually moved (#460).
 *
 * A submenu opens on three things: a click, an arrow key, and the pointer arriving over its row. The
 * third is the problem. A browser re-evaluates what the cursor is over whenever the document changes
 * beneath it, so a panel that materialises under a stationary cursor makes the row it lands on receive
 * a `mouseenter` the user never performed — and if that row carries a submenu, the submenu opens
 * alongside the panel that was just asked for. Clicking a section and getting its first entry's
 * submenu as well is that, and nothing the user did.
 *
 * This sits on the panel's `cdkMenu` element and supplies CDK's own {@link MENU_AIM} seam, which every
 * trigger *inside* the panel consults before opening on hover. Until the pointer has moved, a hover
 * open is dropped; afterwards every one goes straight through, so hovering still opens submenus as it
 * always did. Only the panel's own triggers are affected — a trigger outside it (a section button on
 * the menu bar) finds no aim and is left alone, which is what keeps a bar switching sections on hover.
 *
 * Why the seam rather than making the panel inert to pointer events: `pointer-events: none` would take
 * the panel out of hit-testing entirely, so a click landing before the pointer moved would fall through
 * to whatever sits behind the menu. This gates hover-opening alone and never touches clicks, keyboard
 * navigation or hover highlighting.
 *
 * ⚠️ CDK's own `cdkTargetMenuAim` does not do this. Its `toggle` calls straight through whenever it has
 * recorded no pointer movement, which is exactly the case here.
 */
@Directive({
  selector: '[appMenuPointerGuard]',
  providers: [{ provide: MENU_AIM, useExisting: forwardRef((): unknown => MenuPointerGuard) }],
})
export class MenuPointerGuard implements MenuAim {
  /**
   * Holds the zone the pointer is watched outside of: a mouse move is not application state, and one
   * per pointer sample would schedule a change detection pass for every pixel the user travels.
   */
  private readonly zone: NgZone = inject(NgZone);

  /**
   * Holds the renderer the document listener is attached through.
   */
  private readonly renderer: Renderer2 = inject(Renderer2);

  /**
   * Holds where the pointer was when the panel appeared, or null until the first move is seen.
   *
   * The first `mousemove` after a panel opens is the browser's own — synthesised at the position the
   * cursor was already resting at, to re-run hit-testing against the new document. It is therefore the
   * *baseline*, not a movement, and taking it as one would defeat the whole guard.
   */
  private origin: PointerPosition | null = null;

  /**
   * Holds a value indicating whether the pointer has moved since the panel appeared.
   */
  private moved: boolean = false;

  /**
   * Holds the teardown for the document listener, or null once it is no longer needed.
   */
  private stopWatching: (() => void) | null = null;

  /**
   * Initializes a new instance of the {@link MenuPointerGuard} class, watching for the pointer to move.
   *
   * The watch starts with the panel, because "since the panel appeared" is what is being measured, and
   * it stops the moment the pointer moves — the question is only ever asked once.
   */
  public constructor() {
    this.stopWatching = this.zone.runOutsideAngular((): (() => void) =>
      this.renderer.listen('document', 'mousemove', (event: MouseEvent): void =>
        this.onMouseMove(event),
      ),
    );
    inject(DestroyRef).onDestroy((): void => this.stopListening());
  }

  /**
   * Receives the menu and its pointer tracker from CDK. Neither is needed: the question here is
   * whether the pointer has moved at all, not which row it is travelling toward.
   */
  public initialize(): void {
    // Intentionally empty.
  }

  /**
   * Decides whether a trigger inside the panel may act on the pointer arriving over it.
   * @param doToggle The open (or sibling-close) the trigger is asking to perform.
   */
  public toggle(doToggle: () => void): void {
    if (this.moved) {
      doToggle();
    }
  }

  /**
   * Records the pointer's resting position, and notes the first move away from it.
   * @param event The pointer's move.
   */
  private onMouseMove(event: MouseEvent): void {
    if (this.origin === null) {
      this.origin = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.clientX === this.origin.x && event.clientY === this.origin.y) {
      return;
    }
    this.moved = true;
    this.stopListening();
  }

  /**
   * Detaches the document listener.
   */
  private stopListening(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }
}
