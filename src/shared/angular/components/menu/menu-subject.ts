import { CdkContextMenuTrigger, CdkMenuTrigger, CdkMenuTriggerBase } from '@angular/cdk/menu';
import { Directive, effect, inject, input, InputSignal } from '@angular/core';

/**
 * The shape of the context a menu panel is opened with: the subject rides as `$implicit`, which is
 * what the panel template's `let-data` reads.
 */
interface MenuSubjectContext {
  $implicit: unknown;
}

/**
 * Supplies the subject a row's context menu acts on, in a form that stays current when the row's
 * data changes beneath a trigger that has already opened once.
 *
 * CDK's menu trigger builds its panel portal on the first open and reuses it thereafter, so the data
 * bound through `cdkContextMenuTriggerData` at that moment is the data every later open sees. That is
 * fine while a trigger's row never changes — but a virtual-scrolling list recycles a row's view (and
 * with it the trigger directive) for whatever entry next occupies the slot, and a plain list keeps a
 * view whose id survived while its data did not. Either way a later right-click opens a menu for the
 * row that was there the first time: rename `README.md` to `README.txt` in the Explorer, right-click
 * the renamed row, and the prompt offers to rename `README.md` again (#718).
 *
 * This directive gives the trigger one context object for its lifetime and moves the subject inside
 * it as the input changes. Since the portal holds the object rather than a copy, every open — first
 * or later — reads the row as it currently is. Use it in place of `cdkContextMenuTriggerData` on any
 * trigger whose host row can change identity.
 */
@Directive({
  selector: '[appMenuSubject]',
})
export class MenuSubject {
  /**
   * Gets the subject the menu acts on — the row the trigger sits on.
   */
  public readonly subject: InputSignal<unknown> = input.required<unknown>({ alias: 'appMenuSubject' });

  /**
   * Holds the one context object handed to the trigger; its subject is replaced in place.
   */
  private readonly context: MenuSubjectContext = { $implicit: undefined };

  /**
   * Holds the trigger on the same element, whichever flavour it is.
   */
  private readonly trigger: CdkMenuTriggerBase =
    inject(CdkContextMenuTrigger, { self: true, optional: true }) ??
    inject(CdkMenuTrigger, { self: true });

  /**
   * Initialises a new instance of the {@link MenuSubject} class, handing the trigger its context and
   * keeping the subject inside it current.
   */
  public constructor() {
    this.trigger.menuData = this.context;
    effect((): void => {
      this.context.$implicit = this.subject();
    });
  }
}
