import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  computed,
  contentChild,
  createComponent,
  effect,
  ElementRef,
  EnvironmentInjector,
  inject,
  input,
  InputSignal,
  Injector,
  OnDestroy,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  TemplateRef,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import {
  MODAL_WINDOW_CONFIG,
  ModalWindowHost,
} from '@shared/angular/components/modal-window-host/modal-window-host';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';
import { ModalWindow, ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';

/**
 * Holds the custom properties a caller may theme its modal with, copied from the call site onto the
 * modal window's root so the panel there looks exactly as it did inline. They cannot inherit
 * naturally: the panel no longer lives inside the element that declared them.
 */
const THEMED_PROPERTIES: readonly string[] = [
  '--modal-panel-background',
  '--modal-panel-background-color',
  '--modal-panel-padding',
  '--modal-panel-inline-size',
  '--modal-backdrop-color',
  '--modal-backdrop-blur',
  '--modal-fade-duration',
];

/**
 * Holds the panel width, in rem, used when a caller states none.
 */
const DEFAULT_WIDTH_REM: number = 28;

/**
 * Holds the fraction of the raising window a modal window may occupy before it stops growing and
 * its content scrolls instead.
 */
const MAX_WINDOW_FRACTION: number = 0.9;

/**
 * Represents a reusable modal: a dialog presented in its own operating-system window, above the
 * window that raised it and with that window dimmed behind it.
 *
 * The modal owns the window — opening it, sizing it to the content, centring it, and closing it —
 * while callers project their content and drive the open state. It supports two modes: a dismissable
 * modal (closed by its window's close button or Escape) and a blocking modal (closed only by an
 * action the projected content provides, its window offering no close button).
 *
 * Content is taken as a `<ng-template>` rather than plain projection, because it is instantiated in
 * the modal window with that window's injector: overlays, menus, and drags inside a modal then
 * happen in the modal's own window. Bindings and handlers still act on the component that declared
 * the template. A caller that has not yet moved to a template is rendered the old way — inline, over
 * the raising window's content — which is also the fallback when no window can be opened at all
 * (unit tests, and any environment without a window opener).
 *
 * The panel is themed through `--modal-panel-*` properties, which are carried across to the modal
 * window; the backdrop over the raising window reads the theme's `--modal-backdrop-*` and the global
 * `--modal-fade-duration`.
 */
@Component({
  selector: 'app-modal',
  imports: [AppIcon, NgTemplateOutlet],
  templateUrl: './modal.html',
  styleUrl: './modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class Modal implements OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the opener of modal windows.
   */
  private readonly windows: ModalWindows = inject(ModalWindows);

  /**
   * Holds the backdrop of the window this modal is raised from, dimmed while the modal is open.
   */
  private readonly backdrop: ModalBackdrop = inject(ModalBackdrop);

  /**
   * Holds the document this modal was declared in — the main window's, or a pop-out window's when
   * the modal belongs to a popped-out panel. Its window is the one the modal is raised over.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds this modal's host element, whose computed style carries the caller's theming.
   */
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef) as ElementRef<HTMLElement>;

  /**
   * Holds this modal's injector, the parent of the modal window host's, so content rendered there
   * resolves the services of the view that raised it.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the environment injector modal window hosts are created with.
   */
  private readonly environmentInjector: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds the application, whose change detection the modal window's view attaches to.
   */
  private readonly applicationRef: ApplicationRef = inject(ApplicationRef);

  /**
   * Gets a value indicating whether the modal is shown.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Gets a value indicating whether the modal can be dismissed by the user. When true its window
   * offers a close button and Escape closes it; when false it can only be closed by an action the
   * projected content provides.
   */
  public readonly dismissable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the corner close button is rendered. It applies only to the
   * inline fallback presentation; a modal window is closed through its own window controls.
   */
  public readonly showClose: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the accessible label announced for the dialog, which also titles its window.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the panel width in rem (for example 30 for a 30rem-wide modal). It sizes the modal's
   * window, capped so a modal never opens larger than the window it was raised from. When undefined
   * the panel falls back to its themed default width.
   */
  public readonly width: InputSignal<number | undefined> = input<number>();

  /**
   * Gets a value indicating whether the backdrop acts as a window-drag region. It applies only to
   * the inline fallback presentation; a modal window is moved by its own drag strip.
   */
  public readonly draggableBackdrop: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the modal may be resized. Content that benefits from more room
   * opts in, and its window becomes user-resizable; everything else is sized to its content. In the
   * inline fallback this is the expand/restore control.
   */
  public readonly expandable: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the caller's marked content template, when it has declared one. Only templated content can
   * be presented in a window; anything else falls back to the inline presentation.
   */
  protected readonly content: Signal<ModalContent | undefined> = contentChild(ModalContent);

  /**
   * Holds the open modal window, or null while the modal is closed or presented inline.
   */
  private presented: PresentedModal | null = null;

  /**
   * Holds a value indicating whether the modal is currently presented inline — because it has no
   * templated content, or because no window could be opened for it.
   */
  private readonly inline: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the inline overlay is visible.
   */
  protected readonly inlineVisible: Signal<boolean> = computed(
    (): boolean => this.open() && this.inline(),
  );

  /**
   * Gets the resolved panel inline-size for the inline presentation, or null to defer to the themed
   * default. Capped at the viewport width so the panel stays responsive.
   */
  protected readonly panelInlineSize: Signal<string | null> = computed((): string | null => {
    const width: number | undefined = this.width();
    return width === undefined ? null : `min(${width}rem, 100%)`;
  });

  /**
   * Holds a value indicating whether the inline panel is expanded to fill the window.
   */
  protected readonly expanded: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Emitted when the user dismisses the modal — by closing its window, pressing Escape, or (inline)
   * clicking the backdrop or the close button. The caller owns the open state and is responsible for
   * acting on this.
   */
  public readonly dismiss: OutputEmitterRef<void> = output<void>();

  /**
   * Initializes a new instance of the {@link Modal} class, presenting and retiring its window as the
   * open state changes.
   */
  public constructor() {
    // Both the open state and the content are tracked: the content query resolves as the view is
    // built, so a modal that opens immediately may first be seen without it. Re-running then
    // upgrades the presentation from inline to a window rather than stranding it.
    effect((): void => {
      const open: boolean = this.open();
      const content: ModalContent | undefined = this.content();
      untracked((): void => {
        if (open) {
          this.present(content);
        } else {
          this.retire();
        }
      });
    });
  }

  /**
   * Toggles the inline panel between its default size and filling the window.
   */
  protected toggleExpanded(): void {
    this.expanded.update((value: boolean): boolean => !value);
  }

  /**
   * Requests dismissal, emitting only when the modal is currently dismissable.
   */
  protected requestDismiss(): void {
    if (this.dismissable()) {
      this.dismiss.emit();
    }
  }

  /**
   * Handles a click on the inline backdrop, requesting dismissal only when the click falls on the
   * backdrop itself rather than bubbling up from the panel.
   * @param event The originating click event.
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.requestDismiss();
    }
  }

  /**
   * Handles the Escape key in the raising window, requesting dismissal when the modal is presented
   * inline. A modal window handles its own Escape, in its own document.
   */
  protected onEscape(): void {
    if (this.open() && this.inline()) {
      this.requestDismiss();
    }
  }

  /**
   * Presents the modal: in its own window when its content is templated and a window can be opened,
   * and inline over the raising window's content otherwise.
   * @param content The caller's marked content, when it has declared a template.
   */
  private present(content: ModalContent | undefined): void {
    if (this.presented !== null) {
      return;
    }
    const owner: Window | null = this.document.defaultView;
    if (content === undefined || owner === null) {
      this.inline.set(true);
      return;
    }
    const window: ModalWindow | null = this.windows.open(
      {
        title: this.ariaLabel() ?? 'ONIXLabs Studio',
        width: this.requestedWidth(owner),
        height: this.requestedHeight(owner),
        resizable: this.expandable(),
        closable: this.dismissable(),
        parented: true,
        position: null,
      },
      owner,
    );
    if (window === null) {
      this.inline.set(true);
      return;
    }
    this.inline.set(false);
    this.presented = this.mount(window, content.template, owner);
  }

  /**
   * Mounts the modal's content in an opened window and wires the window's own behaviour: dimming the
   * window behind, sizing to the content, dismissal on Escape, and dismissal when the window closes.
   * @param window The opened modal window.
   * @param content The content to render in it.
   * @param owner The window the modal was raised from.
   * @returns Returns the presentation's bookkeeping.
   */
  private mount(window: ModalWindow, content: TemplateRef<unknown>, owner: Window): PresentedModal {
    this.copyThemedProperties(window.document);

    const host: ComponentRef<ModalWindowHost> = createComponent(ModalWindowHost, {
      environmentInjector: this.environmentInjector,
      elementInjector: Injector.create({
        providers: [
          {
            provide: MODAL_WINDOW_CONFIG,
            useValue: { document: window.document, content, fill: this.expandable() },
          },
        ],
        parent: this.injector,
      }),
      hostElement: window.contentHost.appendChild(window.document.createElement('div')),
    });
    this.applicationRef.attachView(host.hostView);

    const lower: () => void = this.backdrop.raise();

    // Escape closes a dismissable modal from its own window; the raising window's handler cannot
    // see key presses delivered to another window.
    window.view.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && this.dismissable()) {
        this.dismiss.emit();
      }
    });

    // A measured modal's window follows its content: a dialog that grows a validation message, or a
    // list that fills, resizes the window rather than scrolling inside a window sized for what it
    // once held. A filling modal is user-resizable, so it keeps whatever size the user gives it.
    const measure: () => void = (): void => {
      window.fit(
        this.requestedWidth(owner),
        this.clamp(host.instance.measure(), owner.innerHeight),
      );
    };
    const observer: ResizeObserver | null = this.expandable()
      ? null
      : this.observeContent(window, measure);
    if (!this.expandable()) {
      window.view.requestAnimationFrame(measure);
    }

    window.onClosed((): void => {
      observer?.disconnect();
      lower();
      this.applicationRef.detachView(host.hostView);
      host.destroy();
      if (this.presented?.window === window) {
        this.presented = null;
      }
      // A window closed by its own chrome IS the dismissal; a window closed because the caller
      // retired the modal has already had its state cleared, and re-emitting there would be noise.
      if (this.open()) {
        this.dismiss.emit();
      }
    });

    return { window, host, observer, lower };
  }

  /**
   * Observes the modal content's size, so the window keeps fitting it. The observer belongs to the
   * modal's own window, so its callbacks are delivered with that window's frames.
   * @param window The modal window.
   * @param measure The callback re-fitting the window.
   * @returns Returns the observer, or null when the window offers none.
   */
  private observeContent(window: ModalWindow, measure: () => void): ResizeObserver | null {
    const view: Window & typeof globalThis = window.view as Window & typeof globalThis;
    if (typeof view.ResizeObserver !== 'function') {
      return null;
    }
    // The content wrapper is observed, not the window's own host: the wrapper takes the content's
    // natural height, so it changes when the content does and not when the window is resized.
    const content: Element | null = window.contentHost.querySelector('.modal-window-host__content');
    if (content === null) {
      return null;
    }
    const observer: ResizeObserver = new view.ResizeObserver((): void => measure());
    observer.observe(content);
    return observer;
  }

  /**
   * Retires the modal's presentation: closing its window (which unwinds the rest through the closed
   * notification) or clearing the inline overlay.
   */
  private retire(): void {
    this.inline.set(false);
    this.expanded.set(false);
    this.presented?.window.close();
  }

  /**
   * Computes the width the modal window opens at: the caller's width in pixels, capped so a modal
   * never opens wider than the window it was raised from.
   * @param owner The window the modal is raised from.
   * @returns Returns the width in CSS pixels.
   */
  private requestedWidth(owner: Window): number {
    return this.clamp((this.width() ?? DEFAULT_WIDTH_REM) * this.rootFontSize(), owner.innerWidth);
  }

  /**
   * Computes the height the modal window opens at: the room a filling modal is given, or — for a
   * measured one — a modest share of the raising window, which the first measurement corrects
   * before the window is seen at that size.
   * @param owner The window the modal is raised from.
   * @returns Returns the height in CSS pixels.
   */
  private requestedHeight(owner: Window): number {
    return Math.round(owner.innerHeight * (this.expandable() ? 0.7 : 0.35));
  }

  /**
   * Caps a measurement against the window the modal was raised from, leaving a modal always smaller
   * than its parent. Content that exceeds the cap scrolls within the modal.
   * @param value The measurement to cap.
   * @param available The full extent of the raising window.
   * @returns Returns the capped measurement.
   */
  private clamp(value: number, available: number): number {
    return Math.round(Math.min(value, available * MAX_WINDOW_FRACTION));
  }

  /**
   * Reads the application's root font size, so rem-stated widths can be turned into pixels.
   * @returns Returns the root font size in pixels, falling back to the browser default.
   */
  private rootFontSize(): number {
    const size: number = Number.parseFloat(
      getComputedStyle(this.document.documentElement).fontSize || '16',
    );
    return Number.isFinite(size) && size > 0 ? size : 16;
  }

  /**
   * Copies the caller's modal theming onto the modal window's root. The properties are resolved from
   * this element's computed style, so whatever the call site set — directly, or through a class —
   * reaches the window, where the panel can no longer inherit it.
   * @param target The modal window's document.
   */
  private copyThemedProperties(target: Document): void {
    const style: CSSStyleDeclaration = getComputedStyle(this.element.nativeElement);
    for (const property of THEMED_PROPERTIES) {
      const value: string = style.getPropertyValue(property).trim();
      if (value.length > 0) {
        target.documentElement.style.setProperty(property, value);
      }
    }
  }

  /**
   * Closes the modal's window when the component goes away, so a modal can never outlive the view
   * that raised it.
   */
  public ngOnDestroy(): void {
    this.presented?.window.close();
    this.presented = null;
  }
}

/**
 * One presented modal window: the window itself, the host rendering into it, and the resources that
 * unwind when it closes.
 */
interface PresentedModal {
  /**
   * Gets the open window.
   */
  readonly window: ModalWindow;

  /**
   * Gets the host component rendered into it.
   */
  readonly host: ComponentRef<ModalWindowHost>;

  /**
   * Gets the observer keeping the window fitted to its content, or null when the window offers none.
   */
  readonly observer: ResizeObserver | null;

  /**
   * Gets the disposer lowering the backdrop over the raising window.
   */
  readonly lower: () => void;
}
