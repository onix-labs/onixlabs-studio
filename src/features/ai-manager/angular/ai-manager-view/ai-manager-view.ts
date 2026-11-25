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
import { Persona } from '@shared/angular/services/persona/persona';
import { Skills } from '@shared/angular/services/skills/skills';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { ModelManagerSummary, ModelManagerView } from '../model-manager-view/model-manager-view';
import { PersonaSection } from '../persona/persona';
import { SkillLibrarySection } from '../skill-library/skill-library';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { DockContainer } from '@shared/angular/components/dock-layout/dock-container/dock-container';
import { DockTemplatePanel } from '@shared/angular/components/dock-layout/dock-template-panel/dock-template-panel';
import { dockProviders } from '@shared/angular/services/dock-layout/dock-providers';
import { DockSides } from '@shared/angular/services/dock-layout/dock-sides';
import {
  createDockTabRegistrar,
  DockTabRegistrar,
} from '@shared/angular/services/dock-layout/dock-tab-registration';
import {
  TOOL_VIEW_AGENT_PANEL_ID,
  TOOL_VIEW_LIST_PANEL_ID,
  TOOL_VIEW_MAIN_PANEL_ID,
  toolViewConversationContext,
  toolViewDockBlueprint,
} from '@shared/angular/services/tool-view-dock/tool-view-dock';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { AiManagerAgentCapabilities } from '../ai-manager-agent/ai-manager-agent-capabilities';
import { AiManagerSidebar } from '../ai-manager-sidebar/ai-manager-sidebar';
import { AiManagerSidebarState } from '../ai-manager-sidebar/ai-manager-sidebar-state';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

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
 * The AI Manager tab (#948): the AI things the user gets and looks after — local models, the persona
 * and skills — in one tool. The ribbon chooses the sub-view, which lives in
 * {@link AiManagerNavigation} so Settings and the welcome screen can open the tool at one; each
 * sub-view lays out its own side panel. Providers, which are configuration, stay in Settings.
 */
@Component({
  selector: 'app-ai-manager-view',
  imports: [
    AiManagerSidebar,
    AppIcon,
    ModelManagerView,
    PersonaSection,
    SkillLibrarySection,
    AgentConversationPanel,
    DockContainer,
    DockTemplatePanel,
  ],
  // The agent and its conversation live on the VIEW, not the docked panel (#967), so a run outlives
  // the panel being closed and the sub-view being switched.
  providers: [
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'models' },
    AiManagerAgentCapabilities,
    AiManagerSidebarState,
    ...dockProviders(toolViewDockBlueprint('ai-manager', { list: true })),
  ],
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
   * Registers the view's agent with Mission Control and the requests inbox for the tab's whole life.
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'models',
  });

  /**
   * Registers the capabilities the agent acts through, for the view's life.
   */
  private readonly agentCapabilities: AiManagerAgentCapabilities = inject(
    AiManagerAgentCapabilities,
  );

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Exposes the sides a panel may dock to to the template.
   */
  protected readonly DockSides: typeof DockSides = DockSides;

  /**
   * Gets the identifier of the panel holding the view's content.
   */
  protected readonly mainPanel: string = TOOL_VIEW_MAIN_PANEL_ID;

  /**
   * Gets the identifier of the panel holding the view's list.
   */
  protected readonly listPanel: string = TOOL_VIEW_LIST_PANEL_ID;

  /**
   * Gets the identifier of the agent panel.
   */
  protected readonly agentPanel: string = TOOL_VIEW_AGENT_PANEL_ID;

  /**
   * Registers this tab's dock, so the ribbon can open and close its agent. Finalised in
   * {@link ngOnInit} once the tab id is readable.
   */
  private readonly dockTab: DockTabRegistrar = createDockTabRegistrar();

  /**
   * Gets the context the AI Manager's conversations are filed under.
   */
  protected readonly agentContext: ConversationContext = toolViewConversationContext('models');

  /**
   * Holds the section state shared with the ribbon and deep links.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Holds the persona, counted for the status strip.
   */
  private readonly persona: Persona = inject(Persona);

  /**
   * Holds the skill library, counted for the status strip.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Gets the sub-view shown.
   */
  public readonly section: Signal<AiManagerSection | null> = this.navigation.section;

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
   * Gets how many persona entries there are, and how many of them are switched on.
   */
  public readonly personaCounts: Signal<LibraryCounts> = computed((): LibraryCounts =>
    countsOf(this.persona.entries()),
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
    // Every showing opens where it was left, unless something opened it at a section.
    this.navigation.begin();
    this.statusHost.register(this.tabId());
    this.dockTab.register(this.tabId());
    this.agentHost.register(this.tabId());
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
