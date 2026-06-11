import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

/**
 * Represents a small command button in the ribbon, rendering an icon beside a label. Three small
 * buttons stack to the height of a single large {@link RibbonButton}. When {@link toggle} is set
 * the button behaves as a latching toggle, reflecting its {@link pressed} state.
 */
@Component({
  selector: 'app-ribbon-button-small',
  imports: [],
  templateUrl: './ribbon-button-small.html',
  styleUrl: './ribbon-button-small.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonButtonSmall {
  /**
   * Gets the icon CSS class to display (a Tabler webfont class such as `ti ti-copy`).
   */
  public readonly icon: InputSignal<string> = input.required<string>();

  /**
   * Gets the label displayed beside the icon.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the button is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the button is a latching toggle rather than a one-shot action.
   */
  public readonly toggle: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the toggle is currently pressed. Only meaningful when
   * {@link toggle} is set.
   */
  public readonly pressed: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the button is activated.
   */
  public readonly action: OutputEmitterRef<void> = output<void>();

  /**
   * Handles a click on the button, emitting the {@link action} event.
   */
  protected onClick(): void {
    this.action.emit();
  }
}
