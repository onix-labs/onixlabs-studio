import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Represents a horizontal lane within a ribbon group, laying its projected controls out in a row.
 * Paired with a {@link RibbonColumn}, it lets a group stack rows of controls (for example a field
 * above a row of small buttons) within the group's fixed height.
 */
@Component({
  selector: 'app-ribbon-row',
  imports: [],
  templateUrl: './ribbon-row.html',
  styleUrl: './ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RibbonRow {}
