import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  InjectionToken,
  Injector,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { ModalBackdropView } from '@shared/angular/components/modal-backdrop/modal-backdrop-view';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';
import { windowScopedCdkProviders } from '@shared/angular/services/window-scope/window-scope';

/**
 * Configures a modal window's host: the document the modal lives in, and the content to render
 * there. Supplied through the element injector the host is created with, so the host's own
 * providers can build the window's CDK layer around it.
 */
export interface ModalWindowConfig {
  /**
   * Gets the modal window's document, which everything rendered inside must operate in.
   */
  readonly document: Document;

  /**
   * Gets the caller's content. It is declared in the component that owns the modal, so its bindings
   * and handlers still act on that component; only its injection context is this window's.
   */
  readonly content: TemplateRef<unknown>;

  /**
   * Gets a value indicating whether the content fills the window rather than being measured for it.
   * A dialog is sized to what it holds; a modal hosting a whole surface (an editor, a chat) takes
   * the room it is given and the user resizes the window.
   */
  readonly fill: boolean;
}

/**
 * Injects the {@link ModalWindowConfig} of a modal window's host.
 */
export const MODAL_WINDOW_CONFIG: InjectionToken<ModalWindowConfig> =
  new InjectionToken<ModalWindowConfig>('MODAL_WINDOW_CONFIG');

/**
 * Hosts a modal's content inside its own window. The window's CDK layer is provided HERE — overlay
 * container, dispatchers, drag registry, and a fresh-measuring viewport ruler, all scoped to this
 * window and its document — so a dropdown, menu, or drag started inside the modal happens in the
 * modal's window. Everything else resolves through the parent injector to the services of the view
 * that raised the modal, which is what keeps a dialog's content working exactly as it did inline.
 *
 * The host also carries this window's own {@link ModalBackdrop} and renders its layer, so a modal
 * raised from within a modal dims the modal beneath it, not the window further up the chain.
 */
@Component({
  selector: 'app-modal-window-host',
  imports: [NgTemplateOutlet, ModalBackdropView],
  template: `
    <div class="modal-window-host__panel">
      <div #content class="modal-window-host__content">
        <ng-container [ngTemplateOutlet]="config.content" [ngTemplateOutletInjector]="injector" />
      </div>
    </div>
    <app-modal-backdrop />
  `,
  host: {
    '[class.modal-window-host--fill]': 'config.fill',
  },
  styleUrl: './modal-window-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    ...windowScopedCdkProviders(),
    ModalBackdrop,
    {
      provide: DOCUMENT,
      useFactory: (): Document => inject(MODAL_WINDOW_CONFIG).document,
    },
  ],
})
export class ModalWindowHost {
  /**
   * Gets the configuration this window was created with.
   */
  protected readonly config: ModalWindowConfig = inject(MODAL_WINDOW_CONFIG);

  /**
   * Gets this host's injector, which the content is rendered with so anything inside it resolves
   * the window-scoped CDK layer above.
   */
  protected readonly injector: Injector = inject(Injector);

  /**
   * Gets the element wrapping the caller's content, which the modal measures to size the window.
   */
  private readonly content: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('content');

  /**
   * Measures the height the window needs to show all of the content: the content's own height plus
   * the panel's padding, which includes the inset left for the window controls.
   * @returns Returns the required content-area height, in CSS pixels.
   */
  public measure(): number {
    const content: HTMLElement = this.content().nativeElement;
    const panel: HTMLElement | null = content.parentElement;
    const style: CSSStyleDeclaration | null = panel === null ? null : getComputedStyle(panel);
    const padding: number =
      style === null
        ? 0
        : Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd);
    return Math.ceil(content.scrollHeight + (Number.isFinite(padding) ? padding : 0));
  }
}
