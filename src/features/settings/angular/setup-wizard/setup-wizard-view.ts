import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Icon } from '@shared/angular/icons/icon';
import { SetupStep, SetupWizard } from '@shared/angular/services/setup-wizard/setup-wizard';

/**
 * Describes one of the three notes the welcome step carries: a marked, one-line promise about what
 * the pass is for. They are the only decorative content in the wizard, and they earn their place by
 * answering the question a blocking dialog on a first launch always raises — why am I being asked
 * this at all.
 */
interface SetupHighlight {
  /**
   * Gets the mark shown beside the note.
   */
  readonly icon: Icon;

  /**
   * Gets the note's tone, which selects the mark's tint.
   */
  readonly tone: 'quick' | 'tailored' | 'ready';

  /**
   * Gets the note's heading.
   */
  readonly title: string;

  /**
   * Gets the sentence beneath it.
   */
  readonly detail: string;
}

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
  imports: [Modal, ModalContent, Button, AppIcon],
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
   * Gets the notes shown on the welcome step. Fixed content, so a plain constant rather than a
   * signal.
   */
  protected readonly highlights: readonly SetupHighlight[] = [
    {
      icon: Icon.SETUP_QUICK,
      tone: 'quick',
      title: 'Get set up quickly',
      detail: 'A guided configuration in just a few steps.',
    },
    {
      icon: Icon.SETUP_TAILORED,
      tone: 'tailored',
      title: 'Tailored to you',
      detail: 'Customise the tools, UI and workflow.',
    },
    {
      icon: Icon.SETUP_READY,
      tone: 'ready',
      title: 'Ready to build',
      detail: 'Start coding faster with your preferences.',
    },
  ];

  /**
   * Abandons the run, which is what closing the window means: nothing was decided, so the wizard is
   * presented again on the next launch.
   */
  protected abandon(): void {
    this.wizard.abandon();
  }
}
