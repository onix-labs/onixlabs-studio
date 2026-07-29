import { Directive, inject, TemplateRef } from '@angular/core';

/**
 * Marks the template holding a modal's content (`<ng-template appModalContent>`), so
 * {@link import('./modal').Modal} can render it in the modal's own window.
 *
 * The marker is required rather than inferred: modal content routinely contains templates of its own
 * (a CDK menu panel, a deferred block), and an unmarked query would happily seize one of those. It
 * also states the intent at the call site — the content is instantiated elsewhere, in the modal's
 * window, though its bindings still act on the component that declared it.
 */
@Directive({
  selector: 'ng-template[appModalContent]',
})
export class ModalContent {
  /**
   * Gets the marked template.
   */
  public readonly template: TemplateRef<unknown> = inject(TemplateRef);
}
