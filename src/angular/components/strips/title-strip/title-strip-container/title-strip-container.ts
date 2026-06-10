import { Component } from '@angular/core';
import { TitleStripButtonList } from '../title-strip-button-list/title-strip-button-list';
import { TitleStripTabList } from '../title-strip-tab-list/title-strip-tab-list';

@Component({
  selector: 'app-title-strip-container',
  imports: [TitleStripButtonList, TitleStripTabList],
  templateUrl: './title-strip-container.html',
  styleUrl: './title-strip-container.scss',
})
export class TitleStripContainer {}
