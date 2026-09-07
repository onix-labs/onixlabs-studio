import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { SetupStep, SetupWizard } from '@shared/angular/services/setup-wizard/setup-wizard';

/**
 * Presents the setup wizard: the blocking pass a user walks on a first launch and after every version
 * change, before they reach a tab.
 *
 * The component owns the chrome — the title, the progress rail, and Back/Next/Finish — and switches
 * on the current step's identifier to render its content. It owns none of the sequencing: which steps
 * run, in what order, and what completing means all belong to {@link SetupWizard}, which lives in
 * shared because the welcome screen must consult it too.
 *
 * It lives in the settings feature rather than in a feature of its own because its steps render
 * settings, and the renderers for those (`SettingBindings`, `SettingControl`) belong to this feature.
 * Feature isolation forbids a sibling importing them, and the wizard is the settings feature's
 * onboarding face rather than a thing apart from it.
 */
@Component({
  selector: 'app-setup-wizard-view',
  imports: [Modal, ModalContent, Button],
  templateUrl: './setup-wizard-view.html',
  styleUrl: './setup-wizard-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupWizardView {
  /**
   * Holds the service that owns the sequence, exposed for the template.
   */
  protected readonly wizard: SetupWizard = inject(SetupWizard);

  /**
   * Gets the step being shown.
   */
  protected readonly step: Signal<SetupStep | undefined> = this.wizard.current;

  /**
   * Gets the running build's version, for the copy that names it.
   */
  protected readonly version: Signal<string> = computed(
    (): string => window.host?.versions.studio ?? '',
  );

  /**
   * Gets the position through the sequence, as "Step n of m".
   */
  protected readonly progress: Signal<string> = computed(
    (): string => `Step ${this.wizard.stepIndex() + 1} of ${this.wizard.steps().length}`,
  );

  /**
   * Abandons the run, which is what closing the window means: nothing was decided, so the wizard is
   * presented again on the next launch.
   */
  protected abandon(): void {
    this.wizard.abandon();
  }
}
