import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  effect,
  input,
  InputSignal,
  OutputEmitterRef,
  output,
  OutputRefSubscription,
  ViewContainerRef,
  inject,
  DestroyRef,
} from '@angular/core';
import type { Specimen, SpecimenState } from './specimen';

/**
 * Describes something a specimen emitted.
 */
export interface CanvasEvent {
  /**
   * Gets where it came from: specimen, state, theme and width.
   */
  readonly source: string;

  /**
   * Gets the output and what it carried.
   */
  readonly detail: string;
}

/**
 * Renders one specimen in one state (#855), and reports what its outputs emit so a click shows what
 * it would have done.
 */
@Component({
  selector: 'app-canvas-frame',
  imports: [],
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasFrame {
  /**
   * Gets the specimen.
   */
  public readonly specimen: InputSignal<Specimen> = input.required<Specimen>();

  /**
   * Gets the state to render.
   */
  public readonly state: InputSignal<SpecimenState> = input.required<SpecimenState>();

  /**
   * Gets a key unique to this frame, so frames showing the same item do not share radio groups.
   */
  public readonly key: InputSignal<string> = input.required<string>();

  /**
   * Gets where this frame sits, for the event line.
   */
  public readonly source: InputSignal<string> = input.required<string>();

  /**
   * Emits what the specimen's outputs emit.
   */
  public readonly emitted: OutputEmitterRef<CanvasEvent> = output<CanvasEvent>();

  /**
   * Holds where the specimen is rendered.
   */
  private readonly container: ViewContainerRef = inject(ViewContainerRef);

  /**
   * Renders the specimen, again whenever it or its state changes — which is what a hot reload of a
   * fixture does.
   */
  private readonly render: ReturnType<typeof effect> = effect((onCleanup): void => {
    const specimen: Specimen = this.specimen();
    const state: SpecimenState = this.state();
    const key: string = this.key();
    this.container.clear();
    const ref: ComponentRef<unknown> = this.container.createComponent(specimen.component);
    for (const [name, value] of Object.entries(state.inputs)) {
      ref.setInput(name, name === 'item' ? withId(value, key) : value);
    }
    const subscriptions: OutputRefSubscription[] = specimen.outputs.map(
      (name: string): OutputRefSubscription =>
        (ref.instance as Record<string, OutputEmitterRef<unknown>>)[name].subscribe(
          (value: unknown): void =>
            this.emitted.emit({
              source: this.source(),
              detail: `${name}${value === undefined ? '' : ` ${JSON.stringify(value)}`}`,
            }),
        ),
    );
    onCleanup((): void => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    });
  });

  /**
   * Clears the rendered specimen with the frame.
   */
  public constructor() {
    inject(DestroyRef).onDestroy((): void => this.container.clear());
  }
}

/**
 * Gives an item an id unique to its frame.
 * @param value The item input.
 * @param key The frame's key.
 * @returns Returns the item with its frame's id.
 */
function withId(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && 'id' in value
    ? { ...value, id: `${String(value.id)}-${key}` }
    : value;
}
