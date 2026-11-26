import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
} from '@angular/core';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { StackNode } from '../../../services/dock-layout/dock-node';

/**
 * Represents the slot a layout's main group takes: the place its central content is shown, with no
 * tabs, title or buttons of its own.
 *
 * The slot is empty. Rearranging a layout can create it afresh — docking a panel beside a main group that
 * had the whole layout, say — and content inside it would be created afresh with it, restarting a
 * terminal. So {@link import('../dock-container/dock-container').DockContainer} draws the content once,
 * outside the tree, and lays it over this slot.
 */
@Component({
  selector: 'app-dock-main',
  templateUrl: './dock-main.html',
  styleUrl: './dock-main.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockMain {
  /**
   * Holds the geometry registry a drag is hit-tested against.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the slot's element.
   */
  private readonly hostElement: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Gets the main group.
   */
  public readonly stack: InputSignal<StackNode> = input.required<StackNode>();

  public constructor() {
    effect((): void => {
      const stack: StackNode = this.stack();
      this.geometry.registerGroup(stack.id, stack.role, this.hostElement.nativeElement);
    });
    inject(DestroyRef).onDestroy((): void =>
      this.geometry.unregisterGroup(this.stack().id, this.hostElement.nativeElement),
    );
  }
}
