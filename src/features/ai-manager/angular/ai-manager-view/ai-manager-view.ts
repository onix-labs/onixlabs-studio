import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  OnInit,
  Signal,
  viewChild,
} from '@angular/core';
import {
  AiManagerNavigation,
  AiManagerSection,
} from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { PromptProfiles } from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { Skills } from '@shared/angular/services/skills/skills';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { ModelManagerSummary, ModelManagerView } from '../model-manager-view/model-manager-view';
import { PromptProfilesSection } from '../prompt-profiles/prompt-profiles';
import { SkillLibrarySection } from '../skill-library/skill-library';

/**
 * How many entries a library sub-view holds, and how many of them are switched on.
 */
export interface LibraryCounts {
  /**
   * Gets the number of entries.
   */
  readonly total: number;

  /**
   * Gets the number switched on.
   */
  readonly enabled: number;
}

/**
 * The AI Manager tab (#948): the AI things the user gets and looks after — local models, prompt
 * profiles and skills — in one tool. The ribbon chooses the sub-view, which lives in
 * {@link AiManagerNavigation} so Settings and the welcome screen can open the tool at one; each
 * sub-view lays out its own side panel. Providers, which are configuration, stay in Settings.
 */
@Component({
  selector: 'app-ai-manager-view',
  imports: [ModelManagerView, PromptProfilesSection, SkillLibrarySection],
  templateUrl: './ai-manager-view.html',
  styleUrl: './ai-manager-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiManagerView implements OnInit {
  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Publishes this view's injector while it is active, so the status strip mounts the tab's status
   * (#882) inside it, whichever sub-view is shown.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Holds the section state shared with the ribbon and deep links.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Holds the prompt profiles, counted for the status strip.
   */
  private readonly profiles: PromptProfiles = inject(PromptProfiles);

  /**
   * Holds the skill library, counted for the status strip.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Gets the sub-view shown.
   */
  public readonly section: Signal<AiManagerSection> = this.navigation.section;

  /**
   * Gets the Local Models sub-view while it is shown, so its runtime summary can reach the status strip.
   */
  private readonly models: Signal<ModelManagerView | undefined> = viewChild(ModelManagerView);

  /**
   * Gets the Local Models sub-view's summary, or null while another is shown.
   */
  public readonly modelSummary: Signal<ModelManagerSummary | null> = computed(
    (): ModelManagerSummary | null => this.models()?.summary() ?? null,
  );

  /**
   * Gets how many prompt profiles there are, and how many of them are switched on.
   */
  public readonly profileCounts: Signal<LibraryCounts> = computed((): LibraryCounts =>
    countsOf(this.profiles.profiles()),
  );

  /**
   * Gets how many skills there are, and how many of them are switched on.
   */
  public readonly skillCounts: Signal<LibraryCounts> = computed((): LibraryCounts =>
    countsOf(this.skills.skills()),
  );

  /**
   * Publishes this view's injector to the status strip, now that the tab id is readable.
   */
  public ngOnInit(): void {
    this.statusHost.register(this.tabId());
  }
}

/**
 * Counts a library's entries, and those switched on.
 * @param entries The entries.
 * @returns Returns the counts.
 */
function countsOf(entries: readonly { readonly enabled: boolean }[]): LibraryCounts {
  return {
    total: entries.length,
    enabled: entries.filter((entry: { readonly enabled: boolean }): boolean => entry.enabled)
      .length,
  };
}
