import {
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import type { FocusRing, ScrollBars } from '@shared/angular/services/settings/settings-registry';
import { interfaceZoomFactor } from '@shared/api/interface-zoom';

/**
 * Applies the Application › Accessibility settings that reach across the whole interface: Reduce
 * Motion, Scroll Bars, Colour-Blind Safe Colours and Focus Ring are each set as an attribute on the
 * document root (`data-reduced-motion`, `data-scrollbars`, `data-colour-blind-safe`,
 * `data-focus-ring`), which the global styles switch on and child windows mirror.
 *
 * Interface Zoom is applied by the main process, which zooms every window's web contents. What is
 * set here is the zoom factor as `--interface-zoom` on the root, for the few things that must stay
 * the same size on screen whatever the zoom: the room left for the macOS traffic lights, which the
 * operating system draws at its own size.
 *
 * Reduce Motion is also read by the code editors, which animate their own scrolling and caret.
 */
@Service()
export class Accessibility {
  /**
   * Holds the document the attributes are applied to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the settings the choices live in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds whether the operating system asks for reduced motion, kept current as it changes.
   */
  private readonly systemReducesMotion: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether motion is reduced: on when Reduce Motion says so, or when it follows the system and
   * the system asks for it.
   */
  public readonly reducedMotion: Signal<boolean> = computed((): boolean => {
    const choice: string = this.settings.value('accessibility.reduceMotion')();
    return choice === 'on' || (choice === 'system' && this.systemReducesMotion());
  });

  /**
   * Gets whether changes are shown in the colour-blind safe palette.
   */
  public readonly colourBlindSafe: Signal<boolean> = this.settings.value(
    'accessibility.colourBlindSafe',
  );

  /**
   * Gets the zoom factor the interface is drawn at (1 for 100%), from Interface Zoom: how many screen
   * pixels each CSS pixel takes.
   */
  public readonly zoomFactor: Signal<number> = computed((): number =>
    interfaceZoomFactor(this.settings.value('accessibility.interfaceZoom')()),
  );

  /**
   * Gets how scroll bars are shown.
   */
  private readonly scrollBars: Signal<ScrollBars> = this.settings.value('accessibility.scrollBars');

  /**
   * Gets how keyboard focus is drawn.
   */
  private readonly focusRing: Signal<FocusRing> = this.settings.value('accessibility.focusRing');

  /**
   * Initializes the service, following the system's motion preference and applying the settings to
   * the document root now and on every change.
   */
  public constructor() {
    const query: MediaQueryList | undefined = this.prefersReducedMotionQuery();
    if (query !== undefined) {
      this.systemReducesMotion.set(query.matches);
      const onChange: (event: MediaQueryListEvent) => void = (event: MediaQueryListEvent): void =>
        this.systemReducesMotion.set(event.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy((): void => query.removeEventListener('change', onChange));
    }
    effect((): void => {
      const root: HTMLElement = this.document.documentElement;
      if (this.reducedMotion()) {
        root.setAttribute('data-reduced-motion', 'true');
      } else {
        root.removeAttribute('data-reduced-motion');
      }
      root.setAttribute('data-scrollbars', this.scrollBars());
      if (this.colourBlindSafe()) {
        root.setAttribute('data-colour-blind-safe', 'true');
      } else {
        root.removeAttribute('data-colour-blind-safe');
      }
      root.setAttribute('data-focus-ring', this.focusRing());
      root.style.setProperty('--interface-zoom', String(this.zoomFactor()));
    });
  }

  /**
   * Gets the `prefers-reduced-motion: reduce` media query, or undefined where `matchMedia` is
   * unavailable (under unit tests, for one).
   * @returns Returns the media query list, or undefined.
   */
  private prefersReducedMotionQuery(): MediaQueryList | undefined {
    const view: (Window & typeof globalThis) | null = this.document.defaultView;
    if (view === null || typeof view.matchMedia !== 'function') {
      return undefined;
    }
    return view.matchMedia('(prefers-reduced-motion: reduce)');
  }
}
