import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GoToPresenter } from '@shared/angular/services/go-to/go-to-presenter';
import { GoToLineModal } from './go-to-line-modal';
import { GoToSymbolModal } from './go-to-symbol-modal';

/**
 * Mounts the Go to dialogs at the application root (#1009), bound to the {@link GoToPresenter}, so
 * whichever editor asks — in whichever tab or window — the "Dialogs" Go to style shows the same
 * dialog, and there is exactly one of it. Each dialog is created as it opens, so it always starts
 * empty.
 */
@Component({
  selector: 'app-go-to-dialog-host',
  imports: [GoToLineModal, GoToSymbolModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (presenter.dialog(); as dialog) {
      @if (dialog.mode === 'line') {
        <app-go-to-line-modal
          [open]="true"
          [lineCount]="dialog.lineCount"
          (picked)="presenter.complete($event)"
          (dismissed)="presenter.cancel()"
        />
      } @else {
        <app-go-to-symbol-modal
          [open]="true"
          [symbols]="dialog.symbols()"
          (picked)="presenter.complete($event)"
          (dismissed)="presenter.cancel()"
        />
      }
    }
  `,
})
export class GoToDialogHost {
  /**
   * Holds the presenter whose open dialog this host renders.
   */
  protected readonly presenter: GoToPresenter = inject(GoToPresenter);
}
