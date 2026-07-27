import { NgComponentOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  InputSignal,
  Signal,
  Type,
  viewChild,
} from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { Agent } from '@shared/angular/services/agent/agent';
import {
  AGENT_HOST,
  AgentHost,
  AgentHosts,
} from '@shared/angular/services/agent-hosts/agent-hosts';
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
   * Holds the view-scoped tile registry the rail scrolls columns through, and whose trailing spacer this
   * view keeps sized.
   */
  private readonly tiles: MissionControlTiles = inject(MissionControlTiles);

  /**
   * Holds the settings service, so the trailing spacer follows the scroll-mode setting.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the view's injector, the parent of each tile's per-host injector.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Gets the scrolling row element (present only while there are agents to show).
   */
  private readonly rowRef: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('row');

  /**
   * Gets the row's trailing spacer element.
   */
  private readonly spacerRef: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('spacer');

  /**
   * Holds the row currently registered with the tile registry, so the row is wired (and observed) once
   * per rendered instance.
   */
  private observedRow: HTMLElement | null = null;

  /**
   * Holds the tile registry's row cleanup, called when the row is torn down.
   */
  private rowCleanup: (() => void) | null = null;

  /**
   * Holds the observer that re-sizes the trailing spacer when the row's size changes.
   */
  private resizeObserver: ResizeObserver | null = null;

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
   * Initializes a new instance of the {@link MissionControlView} class, wiring the scrolling row to the
   * tile registry once it renders and keeping its trailing spacer sized as the agent set, the scroll
   * mode, or the row's size changes (so left-alignment can reach the last columns).
   */
  public constructor() {
    afterRenderEffect((): void => {
      const row: HTMLElement | undefined = this.rowRef()?.nativeElement;
      const spacer: HTMLElement | undefined = this.spacerRef()?.nativeElement;
      // Re-run when the agent set or scroll mode changes, so the spacer is re-measured against the new
      // layout after the DOM has settled.
      this.hosts();
      this.settings.missionControlTileScrollMode();
      if (row === undefined || spacer === undefined) {
        return;
      }
      if (row !== this.observedRow) {
        this.teardownRow();
        this.rowCleanup = this.tiles.setRow(row, spacer);
        this.resizeObserver = new ResizeObserver((): void => this.tiles.refreshSpacer());
        this.resizeObserver.observe(row);
        this.observedRow = row;
      }
      this.tiles.refreshSpacer();
    });

    inject(DestroyRef).onDestroy((): void => this.teardownRow());
  }

  /**
   * Disconnects the row observer and clears its registration.
   */
  private teardownRow(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.rowCleanup?.();
    this.rowCleanup = null;
    this.observedRow = null;
  }

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
