import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ContentHost } from '../content-host/content-host';
import { RibbonStrip } from '../strips/ribbon-strip/ribbon-strip';
import { StatusStrip } from '../strips/status-strip/status-strip';
import { TitleStripContainer } from '../strips/title-strip/title-strip-container/title-strip-container';

/**
 * Represents the application root, composing the chrome strips and the content host.
 */
@Component({
  selector: 'app-root',
  imports: [RibbonStrip, StatusStrip, TitleStripContainer, ContentHost],
  templateUrl: './root.html',
  styleUrl: './root.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Root {}
