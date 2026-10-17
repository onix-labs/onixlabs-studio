import { CdkMenuItem, CdkMenuItemCheckbox, CdkMenuItemSelectable } from '@angular/cdk/menu';
import { Directive, forwardRef } from '@angular/core';

/**
 * Marks a row of a {@link MultiSelect} panel: a CDK checkbox menu item that keeps the panel open when
 * triggered. The stock item closes every menu on a click, which suits a command but not a tick box —
 * choosing three languages should not take three trips through the dropdown. Registered under the
 * CDK's own item tokens so the enclosing `cdkMenu` still finds it for arrow-key navigation, typeahead
 * and the `menuitemcheckbox` role; Escape and clicking outside still close the panel as usual.
 */
@Directive({
  selector: '[appMultiSelectOption]',
  providers: [
    {
      provide: CdkMenuItemSelectable,
      useExisting: forwardRef((): unknown => MultiSelectOption),
    },
    { provide: CdkMenuItem, useExisting: forwardRef((): unknown => MultiSelectOption) },
  ],
})
export class MultiSelectOption extends CdkMenuItemCheckbox {
  /**
   * Triggers the item, reporting it through `cdkMenuItemTriggered` and leaving the panel open however
   * it was triggered — by pointer, Enter or Space alike.
   */
  public override trigger(): void {
    super.trigger({ keepOpen: true });
  }
}
