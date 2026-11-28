import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ModalBackdropView } from '@shared/angular/components/modal-backdrop/modal-backdrop-view';
import { ModalBackdrop } from '@shared/angular/services/modal-backdrop/modal-backdrop';
import { SHELL_WINDOW } from '@shared/angular/services/tabs/tabs';
import { windowScopedCdkProviders } from '@shared/angular/services/window-scope/window-scope';
import { WINDOW_FRAME_CONFIG } from './window-frame-config';
import { WindowShell } from './window-shell';

/**
 * Hosts a whole Studio window other than the first: the same frame the first shows, laid out as the
 * root shell lays it out, with the window's own document, CDK layer and modal backdrop.
 */
@Component({
  selector: 'app-window-frame',
  imports: [WindowShell, ModalBackdropView],
  template: '<app-window-shell /><app-modal-backdrop />',
  styles: `
    :host {
      display: grid;
      block-size: 100%;
      grid-template-columns: 1fr;
      grid-template-rows: auto auto 1fr auto;
      grid-template-areas:
        'title-strip'
        'ribbon-strip'
        'empty'
        'status-strip';
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    ...windowScopedCdkProviders(),
    ModalBackdrop,
    {
      provide: SHELL_WINDOW,
      useFactory: (): string => inject(WINDOW_FRAME_CONFIG).windowId,
    },
    { provide: DOCUMENT, useFactory: (): Document => inject(WINDOW_FRAME_CONFIG).document },
  ],
})
export class WindowFrame {}
