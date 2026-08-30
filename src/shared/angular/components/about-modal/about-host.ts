import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AboutModal } from './about-modal';

/**
 * Mounts the About dialog at the application root, so the Help menu's entry — which runs in the native
 * bar and can only call back into the renderer — has exactly one dialog to open, in the main window.
 */
@Component({
  selector: 'app-about-host',
  imports: [AboutModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-about-modal />`,
})
export class AboutHost {}
