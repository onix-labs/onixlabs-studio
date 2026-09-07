import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SetupStepSettings } from './setup-step-settings';
import { SetupStepTerminal } from './setup-step-terminal';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';
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
  imports: [Modal, ModalContent, Button, AppIcon, SetupStepSettings, SetupStepTerminal],
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
   * Gets the settings the appearance step asks about: the two choices that change how Studio looks
   * everywhere, and the graphics level, which is here because a machine that renders the heavier
   * effects badly is better told at the start than left to conclude Studio is slow.
   */
  protected readonly appearanceKeys: readonly string[] = [
    'appearance.themeMode',
    'appearance.accent',
    'display.graphicsAcceleration',
  ];

  /**
   * Gets the settings the security step asks about: what content may reach the network, and how much
   * the agent may do before asking. Both default to the cautious answer, which is exactly why they
   * are shown — a user who never opens Settings never learns either default exists.
   */
  protected readonly securityKeys: readonly string[] = [
    'security.imagePolicy',
    'ai.permissionPosture',
  ];

  /**
   * Abandons the run, which is what closing the window means: nothing was decided, so the wizard is
   * presented again on the next launch.
   */
  protected abandon(): void {
    this.wizard.abandon();
  }
}
