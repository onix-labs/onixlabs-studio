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
import {
  ModalWindow,
  ModalWindows,
  ModalWindowSize,
} from '@shared/angular/services/modal-windows/modal-windows';

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
   * Gets whether the modal's window offers a close button, or undefined to follow
   * {@link dismissable}. A blocking modal that must still be closable as a window — the welcome
   * screen standing in for a hidden main window — states it explicitly.
   */
  public readonly closable: InputSignal<boolean | undefined> = input<boolean>();

  /**
   * Gets a value indicating whether the modal stands free of the window that raised it: its window
   * has no parent and no backdrop is raised behind it. This is the welcome screen with no tabs open,
   * where the main window is hidden — a child of a hidden window is not displayed at all on macOS,
   * and there is nothing behind to dim.
   */
  public readonly freestanding: InputSignal<boolean> = input<boolean>(false);

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
   * Gets the panel height in rem, for a modal that fills its window rather than being measured. When
   * undefined a filling modal opens at a share of the space available to it.
   */
  public readonly height: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the smallest width in rem the user may resize the modal's window to, or undefined for the
   * modal default.
   */
  public readonly minWidth: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the smallest height in rem the user may resize the modal's window to, or undefined for the
   * modal default.
   */
  public readonly minHeight: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the largest width in rem the modal's window may take, or undefined for no ceiling beyond
   * the space available to it.
   */
  public readonly maxWidth: InputSignal<number | undefined> = input<number>();

  /**
   * Gets the largest height in rem the modal's window may take, or undefined for no ceiling beyond
   * the space available to it.
   */
  public readonly maxHeight: InputSignal<number | undefined> = input<number>();

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
        closable: this.closable() ?? this.dismissable(),
        parented: !this.freestanding(),
        position: null,
        minimum: this.bound(this.minWidth(), this.minHeight()),
        maximum: this.bound(this.maxWidth(), this.maxHeight()),
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
    this.copyThemedProperties(window.document.body);

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

    // A freestanding modal has nothing behind it to dim: the window it was raised from is hidden.
    const lower: () => void = this.freestanding() ? (): void => undefined : this.backdrop.raise();

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
        this.clamp(
          host.instance.measure(),
          this.available(owner).height,
          this.minHeight(),
          this.maxHeight(),
        ),
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
      // A window closed by its own chrome IS the dismissal — including for a blocking modal, whose
      // window can only have been closed deliberately. A window closed because the caller retired
      // the modal has already had its state cleared, and re-emitting there would be noise.
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
   * Computes the width the modal window opens at: the caller's width, held within its stated bounds
   * and the space available to it.
   * @param owner The window the modal is raised from.
   * @returns Returns the width in CSS pixels.
   */
  private requestedWidth(owner: Window): number {
    const preferred: number = (this.width() ?? DEFAULT_WIDTH_REM) * this.rootFontSize();
    return this.clamp(preferred, this.available(owner).width, this.minWidth(), this.maxWidth());
  }

  /**
   * Computes the height the modal window opens at: the caller's height when it states one, the room
   * a filling modal is given, or — for a measured one — a modest share of the space available,
   * which the first measurement corrects before the window is seen at that size.
   * @param owner The window the modal is raised from.
   * @returns Returns the height in CSS pixels.
   */
  private requestedHeight(owner: Window): number {
    const available: number = this.available(owner).height;
    const stated: number | undefined = this.height();
    const preferred: number =
      stated === undefined
        ? available * (this.expandable() ? 0.8 : 0.35)
        : stated * this.rootFontSize();
    return this.clamp(preferred, available, this.minHeight(), this.maxHeight());
  }

  /**
   * Gets the space a modal window may occupy. A parented modal is held within the window it was
   * raised over; a free-standing one has no window behind it, so it is held within the display
   * instead (its opener is hidden, and may be far smaller than the modal standing in for it).
   * @param owner The window the modal is raised from.
   * @returns Returns the available width and height in CSS pixels.
   */
  private available(owner: Window): { width: number; height: number } {
    return this.freestanding()
      ? { width: owner.screen.availWidth, height: owner.screen.availHeight }
      : { width: owner.innerWidth, height: owner.innerHeight };
  }

  /**
   * Holds a measurement within the modal's stated bounds and the space available to it. A stated
   * minimum wins over the available space: a modal that cannot fit is better oversized than
   * unusable.
   * @param value The measurement to hold.
   * @param available The full extent available to the modal.
   * @param minimum The stated minimum in rem, if any.
   * @param maximum The stated maximum in rem, if any.
   * @returns Returns the held measurement, in CSS pixels.
   */
  private clamp(value: number, available: number, minimum?: number, maximum?: number): number {
    const rem: number = this.rootFontSize();
    const ceiling: number = Math.min(
      maximum === undefined ? Number.POSITIVE_INFINITY : maximum * rem,
      available * MAX_WINDOW_FRACTION,
    );
    const floor: number = minimum === undefined ? 0 : minimum * rem;
    return Math.round(Math.max(floor, Math.min(value, ceiling)));
  }

  /**
   * Builds a window size bound from a stated width and height in rem, when both are stated.
   * @param width The width in rem, if any.
   * @param height The height in rem, if any.
   * @returns Returns the bound in CSS pixels, or null when the modal states none.
   */
  private bound(width?: number, height?: number): ModalWindowSize | null {
    if (width === undefined || height === undefined) {
      return null;
    }
    const rem: number = this.rootFontSize();
    return { width: width * rem, height: height * rem };
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
   * Carries the call site's own theming onto the modal window's root, so the panel there looks
   * exactly as it did inline. Content in a modal window cannot inherit it: the panel no longer lives
   * inside the element that declared it.
   *
   * Only custom properties whose value at the call site DIFFERS from the document root's are
   * carried, which is precisely the caller's own theming (the welcome screen's palette, a bespoke
   * panel background). The app-wide tokens are left alone so the window resolves them live from the
   * mirrored stylesheets, and a theme switch still reaches an open modal.
   * They are written to the window's body rather than its root, whose `style` attribute is mirrored
   * from the opener — anything written there would be wiped.
   * @param target The modal window's body.
   */
  private copyThemedProperties(target: HTMLElement): void {
    const style: CSSStyleDeclaration = getComputedStyle(this.element.nativeElement);
    const root: CSSStyleDeclaration = getComputedStyle(this.document.documentElement);
    for (const property of Array.from(style)) {
      if (!property.startsWith('--')) {
        continue;
      }
      const value: string = style.getPropertyValue(property);
      if (value !== root.getPropertyValue(property)) {
        target.style.setProperty(property, value);
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
