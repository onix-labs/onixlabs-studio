import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Represents the status strip shown along the bottom of a document well. It summarises the active
 * document: the count of errors and warnings, the caret line and column, the file encoding and the
 * editor zoom level. The values are stubbed for now until they are wired to the active document.
 */
@Component({
  selector: 'app-dock-status-strip',
  imports: [AppIcon],
  templateUrl: './dock-status-strip.html',
  styleUrl: './dock-status-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockStatusStrip {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the stubbed number of errors found in the active document.
   */
  protected readonly errors: number = 0;

  /**
   * Gets the stubbed number of warnings found in the active document.
   */
  protected readonly warnings: number = 0;

  /**
   * Gets the stubbed caret line number.
   */
  protected readonly line: number = 1;

  /**
   * Gets the stubbed caret column number.
   */
  protected readonly column: number = 1;

  /**
   * Gets the stubbed document encoding.
   */
  protected readonly encoding: string = 'UTF-8 with BOM';

  /**
   * Gets the stubbed editor zoom level, as a percentage.
   */
  protected readonly zoom: number = 100;
}
