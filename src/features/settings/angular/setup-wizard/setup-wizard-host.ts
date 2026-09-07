import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SetupWizardView } from './setup-wizard-view';

/**
 * Mounts the setup wizard at the application root, so there is exactly one of it, in the main window.
 *
 * Mounting here is also what makes it main-window-only: pop-out windows render through the pop-out
 * dock host rather than the root, so a popped-out panel can never raise a second wizard over the
 * same launch.
 */
@Component({
  selector: 'app-setup-wizard-host',
  imports: [SetupWizardView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-setup-wizard-view />`,
})
export class SetupWizardHost {}
