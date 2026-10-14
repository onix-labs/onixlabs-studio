import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import {
  AiManagerNavigation,
  AiManagerSection,
} from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';

/**
 * What a link page says about the section it opens.
 */
interface LinkCopy {
  /**
   * Gets the sentence saying what the section holds.
   */
  readonly text: string;

  /**
   * Gets the button's label.
   */
  readonly action: string;
}

/**
 * What each AI Manager section's link page says.
 */
const COPY: Readonly<Record<AiManagerSection, LinkCopy>> = {
  models: {
    text: 'Local models — downloaded and run on this machine — are managed in the AI Manager.',
    action: 'Open Local Models',
  },
  profiles: {
    text: 'Prompt profiles — standing instructions the agent follows throughout the conversations they apply to — are managed in the AI Manager.',
    action: 'Open Prompt Profiles',
  },
  skills: {
    text: 'Skills — instructions an agent loads when it decides a task needs them — are managed in the AI Manager.',
    action: 'Open Skills',
  },
};

/**
 * A Settings page that points at a section of the AI Manager (#948). Prompt profiles and skills are
 * things the user builds up and looks after rather than preferences, so they moved to the manager
 * tool; Settings keeps their entries, so someone looking here still finds them, and each one says
 * where they went and opens it.
 */
@Component({
  selector: 'app-ai-manager-link',
  imports: [Button],
  templateUrl: './ai-manager-link.html',
  styleUrl: './ai-manager-link.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiManagerLink {
  /**
   * Gets the AI Manager section the page opens.
   */
  public readonly section: InputSignal<AiManagerSection> = input.required<AiManagerSection>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the AI Manager's deep-link seam.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Gets what the page says.
   */
  protected readonly copy: Signal<LinkCopy> = computed((): LinkCopy => COPY[this.section()]);

  /**
   * Opens the AI Manager at the section.
   */
  protected open(): void {
    this.navigation.open(this.section());
  }
}
