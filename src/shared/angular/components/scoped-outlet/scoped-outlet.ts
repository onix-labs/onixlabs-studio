import {
  Directive,
  effect,
  inject,
  Injector,
  input,
  InputSignal,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';

/**
 * Renders a template the way `ngTemplateOutlet` does, but carries the **injection scope of the place
 * it is written** into the view it creates.
 *
 * ## Why this exists
 *
 * A modal is a separate window, so anything inside it needs that window's CDK layer — overlay
 * container, dispatchers, viewport ruler. {@link import('../modal-window-host/modal-window-host').ModalWindowHost}
 * provides exactly that and renders the caller's content with its own injector, which works: a
 * component written directly in the content template resolves the window's services.
 *
 * ⛔ **It stops working at the next template boundary.** An embedded view resolves through its
 * *declaration* site, and `ngTemplateOutletInjector` only supplies a fallback for the view it
 * creates — a *nested* `ngTemplateOutlet` starts again from its own declaration site with no
 * fallback at all, so everything inside it resolves the root injector. Proven by this directive's
 * spec: through a plain nested outlet the scoped token reads `root`; through this one it reads the
 * scope.
 *
 * 🔥 The symptom is not an error. A menu opened from such a view renders into the **main window's**
 * overlay container, positioned against the **main window's** viewport — so it appears offset, and
 * behind a modal that is a different OS window and therefore cannot be stacked under it. That was
 * issue #692: the quick-responses and shortcuts panels of a focused Mission Control agent.
 *
 * ## How it works
 *
 * The directive is instantiated *inside* the enclosing embedded view, so the {@link Injector} it
 * injects already resolves through that view's fallback. Handing that same injector to the view it
 * creates passes the scope along, however many boundaries deep.
 *
 * ⚠️ In the main window this is a no-op by construction: the injector it captures is the ordinary
 * root chain, so it renders exactly as `ngTemplateOutlet` would. Prefer it over `ngTemplateOutlet`
 * for any template that might be rendered into a modal or a popped-out dock — which is not knowable
 * from the template being rendered, only from every place that renders it.
 */
@Directive({
  selector: '[appScopedOutlet]',
})
export class ScopedOutlet {
  /**
   * Gets the template to render.
   */
  public readonly template: InputSignal<TemplateRef<unknown>> = input.required<
    TemplateRef<unknown>
  >({ alias: 'appScopedOutlet' });

  /**
   * Gets the container the view is created in.
   */
  private readonly container: ViewContainerRef = inject(ViewContainerRef);

  /**
   * Gets the injector of the position this directive occupies, which is the whole point: written
   * inside an embedded view, it resolves through that view's scope rather than the root.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Initialises a new instance of the {@link ScopedOutlet} class.
   */
  public constructor() {
    effect((): void => {
      const template: TemplateRef<unknown> = this.template();
      // Cleared rather than diffed: the template is an identity, so a new one is a different view
      // and there is nothing to reconcile.
      this.container.clear();
      this.container.createEmbeddedView(template, undefined, { injector: this.injector });
    });
  }
}
