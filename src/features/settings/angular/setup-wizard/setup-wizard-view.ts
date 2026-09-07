import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SetupStepAiProvider } from './setup-step-ai-provider';
import { SetupStepEnvironment } from './setup-step-environment';
import { SetupStepSettings } from './setup-step-settings';
import { SetupStepSourceControl } from './setup-step-source-control';
import { SetupStepTooling } from './setup-step-tooling';
import { SetupStepTerminal } from './setup-step-terminal';
import { SetupStepWhatsNew } from './setup-step-whats-new';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';
import {
  SETUP_STEP_SETTINGS,
  SetupStep,
  SetupWizard,
} from '@shared/angular/services/setup-wizard/setup-wizard';

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
  imports: [
    Modal,
    ModalContent,
    Button,
    AppIcon,
    SetupStepSettings,
    SetupStepTerminal,
    SetupStepWhatsNew,
    SetupStepEnvironment,
    SetupStepTooling,
    SetupStepAiProvider,
    SetupStepSourceControl,
  ],
  templateUrl: './setup-wizard-view.html',
  styleUrl: './setup-wizard-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupWizardView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

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
   * Gets the settings each step presents, read from the same map the delta rules consult.
   *
   * One list, not two. The wizard decides whether an appearance step runs by asking what settings it
   * is about; if the panel then rendered a different list, a step could be skipped for having nothing
   * new while showing something new, or run for a setting it never displays.
   */
  protected readonly stepSettings: Readonly<Record<string, readonly string[]>> =
    SETUP_STEP_SETTINGS;

  /**
   * Abandons the run, which is what closing the window means: nothing was decided, so the wizard is
   * presented again on the next launch.
   */
  protected abandon(): void {
    this.wizard.abandon();
  }
}
