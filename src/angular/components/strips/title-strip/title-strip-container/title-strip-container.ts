import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TitleStripButtonList } from '../title-strip-button-list/title-strip-button-list';
import { TitleStripTabList } from '../title-strip-tab-list/title-strip-tab-list';
import { WindowControls } from '../window-controls/window-controls';

/**
 * Represents the title strip, hosting the action buttons, the tab list, and the window controls.
 */
@Component({
  selector: 'app-title-strip-container',
  imports: [TitleStripButtonList, TitleStripTabList, WindowControls],
  templateUrl: './title-strip-container.html',
  styleUrl: './title-strip-container.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripContainer {}
