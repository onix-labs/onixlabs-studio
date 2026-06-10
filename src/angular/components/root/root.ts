import { Component } from '@angular/core';
import { RibbonStrip } from '../strips/ribbon-strip/ribbon-strip';
import { StatusStrip } from '../strips/status-strip/status-strip';
import { TitleStripContainer } from '../strips/title-strip/title-strip-container/title-strip-container';

@Component({
  selector: 'app-root',
  imports: [RibbonStrip, StatusStrip, TitleStripContainer],
  templateUrl: './root.html',
  styleUrl: './root.scss',
})
export class Root {}
