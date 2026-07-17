import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  InputSignal,
  Signal,
  Type,
} from '@angular/core';
import { Agent } from '@shared/angular/services/agent/agent';
import { AGENT_HOST, AgentHost, AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { MissionControlPanel } from './mission-control-panel/mission-control-panel';
import { MissionControlAgentTile } from './mission-control-agent-tile/mission-control-agent-tile';
import { MissionControlTiles } from './mission-control-tiles';

/**
 * The Mission Control feature view: a single place to manage every live agent. A left
 * {@link MissionControlPanel} lists every live agent as a rail — clicking a row scrolls its column into
 * view and each row answers that agent's pending requests inline — and mirrors the permission settings;
 * the main area is a horizontally-scrolling row of {@link MissionControlAgentTile}s, one per **live
 * agent host** ({@link AgentHosts}) — an agent tab, or a docked agent panel that has been opened. Each
 * tile mirrors its host's live {@link Agent}/{@link AgentConversation}: the view builds a per-host
 * injector that provides those instances (and the host handle), so the tile drives the very same session
 * as the origin rather than a copy. A view-scoped {@link MissionControlTiles} registry lets the rail
 * scroll a tile into view.
 */
@Component({
  selector: 'app-mission-control-view',
  imports: [NgComponentOutlet, PanelLayout, Panel, MissionControlPanel],
  templateUrl: './mission-control-view.html',
  styleUrl: './mission-control-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [MissionControlTiles],
})
export class MissionControlView {
  /**
   * Holds the app-wide live-hosts registry the agent columns mirror.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the view's injector, the parent of each tile's per-host injector.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Caches one injector per live host, so a tile is not torn down and rebuilt every change detection.
   * Weakly keyed so an unregistered host's injector is collected with it.
   */
  private readonly injectors: WeakMap<AgentHost, Injector> = new WeakMap<AgentHost, Injector>();

  /**
   * Gets the tile component the outlet mounts per host, exposed for the template.
   */
  protected readonly Tile: Type<MissionControlAgentTile> = MissionControlAgentTile;

  /**
   * Gets the identifier of the Mission Control tab.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the Mission Control tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the live agent hosts, one column each.
   */
  protected readonly hosts: Signal<readonly AgentHost[]> = this.agentHosts.hosts;

  /**
   * Gets the inputs passed to every tile: whether Mission Control is the active tab, so mirrors follow
   * the tail while on screen.
   */
  protected readonly tileInputs: Signal<Record<string, unknown>> = computed(
    (): Record<string, unknown> => ({ active: this.isActive() }),
  );

  /**
   * Gets the injector for a host's tile, providing the host's live agent session and conversation (so
   * the reused agent UI drives the same instances) and the host handle for the tile's chrome. Cached
   * per host.
   * @param host The host to build (or reuse) an injector for.
   * @returns Returns the host's tile injector.
   */
  protected injectorFor(host: AgentHost): Injector {
    let injector: Injector | undefined = this.injectors.get(host);
    if (injector === undefined) {
      injector = Injector.create({
        parent: this.injector,
        providers: [
          { provide: Agent, useValue: host.agent },
          { provide: AgentConversation, useValue: host.conversation },
          { provide: AGENT_HOST, useValue: host },
        ],
      });
      this.injectors.set(host, injector);
    }
    return injector;
  }
}
