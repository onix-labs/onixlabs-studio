import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents a labelled settings row: a label and optional description paired with a single form
 * control. The row is a `<label>` element, so it provides the accessible name for the control
 * projected into it (no per-control label is needed).
 */
@Component({
  selector: 'app-setting-row',
  imports: [],
  templateUrl: './setting-row.html',
  styleUrl: './setting-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingRow {
  /**
   * Gets the label shown for the row.
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets the optional description shown beneath the label.
   */
  public readonly description: InputSignal<string> = input<string>('');
}
