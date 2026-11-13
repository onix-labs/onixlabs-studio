import {
  CdkMenuTrigger,
  Menu,
  MENU_AIM,
  MENU_STACK,
  MenuAim,
  MenuStack,
  MenuStackCloseEvent,
} from '@angular/cdk/menu';
import {
  DestroyRef,
  Directive,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  OnInit,
} from '@angular/core';
import { Subscription } from 'rxjs';

/**
 * Makes a `cdkMenuTriggerFor` that sits inside a menu panel, without being one of its items, behave
 * as a button that opens a menu: on a click, and closed again when the panel moves on.
 *
 * A trigger inside a panel is, to CDK, a submenu row, and it gets two things wrong for a button beside
 * the panel's rows — a row's More Actions button, say:
 *
 * - It opens on hover. CDK opens a nested trigger the moment the pointer arrives over it, so sweeping
 *   down a column of such buttons opens each menu in turn. This supplies the trigger's own
 *   {@link MENU_AIM}, which CDK consults before every hover open, and drops every one: only a click or
 *   the keyboard opens it.
 * - It never closes. CDK leaves closing a submenu to the panel's `cdkMenuItem` that carries the
 *   trigger; when the panel moves on — the pointer over another row, a press elsewhere in it, another
 *   such menu opening — it pops the submenu off the menu stack and has that item close it. A trigger
 *   that is not an item has nobody to close it, so its menu is popped and left on screen, and the
 *   next one stacks on top. This closes the trigger's menu as the stack pops it.
 *
 * The menu still opens in the panel's own stack, so a press inside it is not a click away from the
 * panel.
 */
@Directive({
  selector: '[appMenuClickTrigger]',
  providers: [{ provide: MENU_AIM, useExisting: forwardRef((): unknown => MenuClickTrigger) }],
})
export class MenuClickTrigger implements MenuAim, OnInit {
  /**
   * Holds the injector the trigger is resolved through. The trigger injects this directive, as its
   * aim, while it is being built, so it cannot be injected back until both exist.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the menu stack the trigger's menu opens in: the panel's.
   */
  private readonly menuStack: MenuStack = inject(MENU_STACK);

  /**
   * Holds the trigger's host element.
   */
  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /**
   * Holds the teardown run as the directive is destroyed.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Closes the trigger's menu as the stack pops it.
   */
  public ngOnInit(): void {
    const trigger: CdkMenuTrigger = this.injector.get(CdkMenuTrigger, undefined, { self: true });
    const subscription: Subscription = this.menuStack.closed.subscribe(
      ({ item }: MenuStackCloseEvent): void => {
        const menu: Menu | undefined = trigger.getMenu();
        if (menu === undefined || item !== menu || !trigger.isOpen()) {
          return;
        }
        // Focus inside the closing menu would fall to the page as the menu goes, and a stack that has
        // lost focus closes outright — the panel with it. The trigger keeps it in the panel.
        const focused: Element | null = document.activeElement;
        const holdsFocus: boolean = focused !== null && menu.nativeElement.contains(focused);
        trigger.close();
        if (holdsFocus) {
          (this.host.matches('button') ? this.host : this.host.querySelector('button'))?.focus();
        }
      },
    );
    this.destroyRef.onDestroy((): void => subscription.unsubscribe());
  }

  /**
   * Receives the menu and its pointer tracker from CDK. Neither is needed: hovering never opens.
   */
  public initialize(): void {
    // Intentionally empty.
  }

  /**
   * Drops the open CDK asks to perform as the pointer arrives over the trigger.
   */
  public toggle(): void {
    // Intentionally empty: the trigger opens on a click or a key, never on hover.
  }
}
