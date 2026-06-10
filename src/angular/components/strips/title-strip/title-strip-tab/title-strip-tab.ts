import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-title-strip-tab',
  imports: [],
  templateUrl: './title-strip-tab.html',
  styleUrl: './title-strip-tab.scss',
})
export class TitleStripTab {
  @Input()
  public isActive: boolean = false;
}
