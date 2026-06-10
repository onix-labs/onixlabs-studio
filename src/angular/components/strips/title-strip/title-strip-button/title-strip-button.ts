import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-title-strip-button',
  imports: [],
  templateUrl: './title-strip-button.html',
  styleUrl: './title-strip-button.scss',
})
export class TitleStripButton {
  @Input()
  public icon: string = '';
}
