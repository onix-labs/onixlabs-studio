import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DatabaseConnection, DatabaseQuery } from '@shared/api/database-document';
import { DatabaseEngineInfo } from '@shared/api/database-engine-protocol';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { DockMinimums } from '@shared/angular/services/dock-layout/dock-minimums';
import { Icon } from '@shared/angular/icons/icon';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  collectPanelIds,
  findDocumentWell,
  findStackOfPanel,
} from '@shared/angular/services/dock-layout/dock-tree';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { PanelPopout } from '@shared/angular/services/panel-popout/panel-popout';
import { DatabaseAgentCapabilities } from '../database-agent-capabilities/database-agent-capabilities';
import { DatabaseClient } from '../database-client/database-client';
import { DatabaseCompletions } from '../database-completions/database-completions';
import { DATABASE_EXPLORER_DOCK_BLUEPRINT } from '../database-explorer-dock-blueprint';
import {
  ConnectionTarget,
  DatabaseExplorerCommands,
  RibbonPanel,
} from '../database-explorer-commands/database-explorer-commands';
import { DatabasePrompts } from '../database-prompts/database-prompts';
import { DatabaseQueryOpener } from '../database-query-opener/database-query-opener';
import { DatabaseSelection, DatabaseWorkspace } from '../database-workspace/database-workspace';
import { DatabaseExplorerView } from './database-explorer-view';

/**
 * A stand-in for the tab's workspace: the connections, queries, sessions and selection the view reads,
 * and a record of what it asked of them.
 */
class FakeWorkspace {
  /**
   * Holds every disconnect and refresh the view asked for.
   */
  public readonly calls: string[] = [];

  public readonly connections: WritableSignal<readonly DatabaseConnection[]> = signal<
    readonly DatabaseConnection[]
  >([]);
  public readonly queries: WritableSignal<readonly DatabaseQuery[]> = signal<
    readonly DatabaseQuery[]
  >([]);
  public readonly sessions: WritableSignal<ReadonlyMap<string, unknown>> = signal<
    ReadonlyMap<string, unknown>
  >(new Map<string, unknown>());
  public readonly connecting: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );
  public readonly running: WritableSignal<ReadonlyMap<string, string>> = signal<
    ReadonlyMap<string, string>
  >(new Map<string, string>());
  public readonly selection: WritableSignal<DatabaseSelection | null> =
    signal<DatabaseSelection | null>(null);
  public readonly filePath: WritableSignal<string | null> = signal<string | null>(null);
  public readonly dirty: WritableSignal<boolean> = signal<boolean>(false);
  public readonly documentName: WritableSignal<string> = signal<string>('Untitled');
  public readonly hasPassphrase: WritableSignal<boolean> = signal<boolean>(false);
  public readonly locked: WritableSignal<boolean> = signal<boolean>(false);
  public readonly engines: WritableSignal<readonly DatabaseEngineInfo[]> = signal<
    readonly DatabaseEngineInfo[]
  >([]);

  /**
   * Finds a connection.
   * @param id The connection's id, or null.
   * @returns Returns it, or undefined.
   */
  public connection(id: string | null): DatabaseConnection | undefined {
    return this.connections().find(
      (connection: DatabaseConnection): boolean => connection.id === id,
    );
  }

  /**
   * Finds a query.
   * @param id The query's id.
   * @returns Returns it, or undefined.
   */
  public query(id: string): DatabaseQuery | undefined {
    return this.queries().find((query: DatabaseQuery): boolean => query.id === id);
  }

  /**
   * Records a disconnect.
   * @param id The connection's id.
   * @returns Returns a settled promise.
   */
  public disconnect(id: string): Promise<void> {
    this.calls.push(`disconnect:${id}`);
    return Promise.resolve();
  }

  /**
   * Records a refresh.
   * @param id The connection's id.
   * @param node The node to refresh, or null for the whole tree.
   * @returns Returns a settled promise.
   */
  public refresh(id: string, node: unknown): Promise<void> {
    this.calls.push(`refresh:${id}:${String(node)}`);
    return Promise.resolve();
  }

  /**
   * Closes every session; nothing to do here.
   * @returns Returns a settled promise.
   */
  public closeAll(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A stand-in for the tab's dialogs, recording which it raised.
 */
class FakePrompts {
  /**
   * Holds every dialog the view raised.
   */
  public readonly calls: string[] = [];

  public readonly engine: WritableSignal<DatabaseEngineInfo | null> =
    signal<DatabaseEngineInfo | null>(null);

  /**
   * Records a connect.
   * @param id The connection's id.
   */
  public connect(id: string): void {
    this.calls.push(`connect:${id}`);
  }

  /**
   * Records an edit.
   * @param id The connection's id.
   */
  public editConnection(id: string): void {
    this.calls.push(`edit:${id}`);
  }

  /**
   * Records a new connection.
   */
  public newConnection(): void {
    this.calls.push('new');
  }

  /**
   * Records an unlock prompt.
   */
  public askUnlock(): void {
    this.calls.push('unlock');
  }
}

/**
 * Builds a connection.
 * @param id The connection's id.
 * @param name Its name.
 * @returns Returns the connection.
 */
function connection(id: string, name: string): DatabaseConnection {
  return { id, name, engine: 'postgres', values: {} };
}

/**
 * Builds a query.
 * @param id The query's id.
 * @param connectionId The connection it runs against, or null.
 * @returns Returns the query.
 */
function query(id: string, connectionId: string | null): DatabaseQuery {
  return { id, title: id, connectionId, text: '' };
}

describe('DatabaseExplorerView', () => {
  let fixture: ComponentFixture<DatabaseExplorerView>;
  let view: DatabaseExplorerView;
  let workspace: FakeWorkspace;
  let prompts: FakePrompts;
  let dockState: DockState;
  let dockFloating: DockFloating;
  let popoutPanels: PopoutPanels;
  let dockReveal: DockReveal;
  let tabContext: DockTabContext;

  beforeEach(() => {
    workspace = new FakeWorkspace();
    prompts = new FakePrompts();
    TestBed.configureTestingModule({ imports: [DatabaseExplorerView] });
    TestBed.overrideComponent(DatabaseExplorerView, {
      set: {
        template: '',
        imports: [],
        providers: [
          { provide: DatabaseWorkspace, useValue: workspace },
          { provide: DatabasePrompts, useValue: prompts },
          {
            provide: DatabaseQueryOpener,
            useValue: { open: (): void => undefined, run: (): void => undefined },
          },
          { provide: DatabaseClient, useValue: {} },
          { provide: DatabaseCompletions, useValue: {} },
          { provide: DatabaseAgentCapabilities, useValue: {} },
          { provide: Agent, useValue: {} },
          { provide: AgentConversation, useValue: {} },
          DockTabContext,
          DockState,
          DockGeometry,
          DockMinimums,
          DockFocus,
          DockPanelRegistry,
          DockFloating,
          DockAutoHide,
          DockDrag,
          DockReveal,
          PopoutPanels,
          PanelPopout,
          { provide: DOCK_BLUEPRINT, useValue: DATABASE_EXPLORER_DOCK_BLUEPRINT },
        ],
      },
    });
    fixture = TestBed.createComponent(DatabaseExplorerView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    view = fixture.componentInstance;
    dockState = fixture.debugElement.injector.get(DockState);
    dockFloating = fixture.debugElement.injector.get(DockFloating);
    popoutPanels = fixture.debugElement.injector.get(PopoutPanels);
    dockReveal = fixture.debugElement.injector.get(DockReveal);
    tabContext = fixture.debugElement.injector.get(DockTabContext);
    fixture.detectChanges();
    TestBed.tick();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Puts a query in front in the document well.
   * @param id The query's id.
   */
  function front(id: string): void {
    const well: StackNode | null = findDocumentWell(dockState.layout());
    if (well === null) {
      throw new Error('No document well');
    }
    dockState.tabInto(well.id, id);
  }

  /**
   * Reads whether each tool panel shows, by id.
   * @returns Returns the open flags, keyed by panel id.
   */
  function openPanels(): Readonly<Record<string, boolean>> {
    return Object.fromEntries(
      view.panels().map((panel: RibbonPanel): [string, boolean] => [panel.id, panel.open]),
    );
  }

  it('ngOnInit_registersTheViewWithTheRibbonsCommands', () => {
    workspace.connections.set([connection('c1', 'Production')]);
    workspace.selection.set({ kind: 'connection', connectionId: 'c1' });

    expect(TestBed.inject(DatabaseExplorerCommands).connectionTarget()?.id).toBe('c1');
  });

  describe('connectionTarget', () => {
    beforeEach(() => {
      workspace.connections.set([connection('c1', 'Production'), connection('c2', 'Staging')]);
      workspace.queries.set([query('q1', 'c2'), query('q2', null)]);
    });

    it('withNothingSelectedOrInFront_isNull', () => {
      expect(view.connectionTarget()).toBeNull();
    });

    it('withAConnectionSelected_isThatConnection', () => {
      workspace.selection.set({ kind: 'connection', connectionId: 'c1' });

      expect(view.connectionTarget()).toEqual({ id: 'c1', name: 'Production', state: 'closed' });
    });

    it('withATreeNodeSelected_isTheConnectionItBelongsTo', () => {
      workspace.selection.set({
        kind: 'node',
        connectionId: 'c1',
        node: { id: 'n1', label: 'users', kind: 'table' },
      } as unknown as DatabaseSelection);

      expect(view.connectionTarget()?.id).toBe('c1');
    });

    it('withNothingSelected_isTheConnectionOfTheQueryInFront', () => {
      front('q1');

      expect(view.connectionTarget()).toEqual({ id: 'c2', name: 'Staging', state: 'closed' });
    });

    it('withASelection_prefersItOverTheQueryInFront', () => {
      front('q1');
      workspace.selection.set({ kind: 'connection', connectionId: 'c1' });

      expect(view.connectionTarget()?.id).toBe('c1');
    });

    it('withAGraphSelection_fallsBackToTheQueryInFront', () => {
      front('q1');
      workspace.selection.set({ kind: 'graph', title: 'Node', properties: [] });

      expect(view.connectionTarget()?.id).toBe('c2');
    });

    it('withAnUnboundQueryInFront_isNull', () => {
      front('q2');

      expect(view.connectionTarget()).toBeNull();
    });

    it('withAnUnknownConnectionSelected_isNull', () => {
      workspace.selection.set({ kind: 'connection', connectionId: 'gone' });

      expect(view.connectionTarget()).toBeNull();
    });

    it('state_followsTheSessionsAndConnectingSets', () => {
      workspace.selection.set({ kind: 'connection', connectionId: 'c1' });
      workspace.connecting.set(new Set<string>(['c1']));
      expect(view.connectionTarget()?.state).toBe('connecting');

      workspace.sessions.set(new Map<string, unknown>([['c1', {}]]));
      expect(view.connectionTarget()?.state).toBe('open');
    });
  });

  describe('toggleConnection', () => {
    beforeEach(() => {
      workspace.connections.set([connection('c1', 'Production')]);
      workspace.selection.set({ kind: 'connection', connectionId: 'c1' });
    });

    it('withAClosedTarget_asksToConnect', () => {
      view.toggleConnection();

      expect(prompts.calls).toEqual(['connect:c1']);
      expect(workspace.calls).toEqual([]);
    });

    it('withAnOpenTarget_disconnects', () => {
      workspace.sessions.set(new Map<string, unknown>([['c1', {}]]));

      view.toggleConnection();

      expect(workspace.calls).toEqual(['disconnect:c1']);
      expect(prompts.calls).toEqual([]);
    });

    it('whileConnecting_doesNothing', () => {
      workspace.connecting.set(new Set<string>(['c1']));

      view.toggleConnection();

      expect(workspace.calls).toEqual([]);
      expect(prompts.calls).toEqual([]);
    });

    it('withNoTarget_doesNothing', () => {
      workspace.selection.set(null);

      view.toggleConnection();

      expect(workspace.calls).toEqual([]);
      expect(prompts.calls).toEqual([]);
    });
  });

  describe('refreshConnection', () => {
    beforeEach(() => {
      workspace.connections.set([connection('c1', 'Production')]);
      workspace.selection.set({ kind: 'connection', connectionId: 'c1' });
    });

    it('withAnOpenTarget_rereadsItsWholeTree', () => {
      workspace.sessions.set(new Map<string, unknown>([['c1', {}]]));

      view.refreshConnection();

      expect(workspace.calls).toEqual(['refresh:c1:null']);
    });

    it('withAClosedTarget_doesNothing', () => {
      view.refreshConnection();

      expect(workspace.calls).toEqual([]);
    });
  });

  describe('editConnection', () => {
    it('withATarget_opensItsEditDialog', () => {
      workspace.connections.set([connection('c1', 'Production')]);
      workspace.selection.set({ kind: 'connection', connectionId: 'c1' });

      view.editConnection();

      expect(prompts.calls).toEqual(['edit:c1']);
    });

    it('withNoTarget_doesNothing', () => {
      view.editConnection();

      expect(prompts.calls).toEqual([]);
    });
  });

  describe('panels', () => {
    it('listsTheBlueprintsToolPanels_withTheirTitlesAndIcons', () => {
      const tools: readonly DockPanel[] = DATABASE_EXPLORER_DOCK_BLUEPRINT.panels.filter(
        (panel: DockPanel): boolean => panel.role === 'tool',
      );

      expect(view.panels().map((panel: RibbonPanel): string => panel.id)).toEqual([
        'objects',
        'properties',
        'agent',
        'terminal',
      ]);
      expect(
        view
          .panels()
          .map((panel: RibbonPanel): readonly [string, Icon] => [panel.title, panel.icon]),
      ).toEqual(
        tools.map((panel: DockPanel): readonly [string, Icon] => [panel.title, panel.icon]),
      );
    });

    it('inTheDefaultLayout_showsAllButTheTerminal', () => {
      expect(openPanels()).toEqual({
        objects: true,
        properties: true,
        agent: true,
        terminal: false,
      });
    });

    it('whenClosed_isNotShowing', () => {
      dockState.removeFromLayout('properties');

      expect(openPanels()['properties']).toBe(false);
    });

    it('whenFloating_isShowing', () => {
      dockFloating.float('terminal', { left: 0, top: 0, width: 100, height: 100 });

      expect(openPanels()['terminal']).toBe(true);
    });

    it('whenPoppedOut_isShowing', () => {
      dockState.removeFromLayout('agent');
      popoutPanels.markPopped('agent', (): void => undefined);

      expect(openPanels()['agent']).toBe(true);
    });
  });

  describe('togglePanel', () => {
    it('whenPoppedOut_bringsItsWindowForward', () => {
      const focus: () => void = vi.fn<() => void>();
      dockState.removeFromLayout('agent');
      popoutPanels.markPopped('agent', focus);
      const reveal: ReturnType<typeof vi.spyOn> = vi.spyOn(dockReveal, 'reveal');

      view.togglePanel('agent');

      expect(reveal).toHaveBeenCalledWith('agent');
      expect(focus).toHaveBeenCalled();
      expect(popoutPanels.isPopped('agent')).toBe(true);
    });

    it('whenFloating_closesTheFloat', async () => {
      dockFloating.float('terminal', { left: 0, top: 0, width: 100, height: 100 });

      view.togglePanel('terminal');
      await fixture.whenStable();

      expect(dockFloating.floats()).toEqual([]);
      expect(collectPanelIds(dockState.layout())).not.toContain('terminal');
    });

    it('whenDocked_closesIt', async () => {
      view.togglePanel('objects');
      await fixture.whenStable();

      expect(collectPanelIds(dockState.layout())).not.toContain('objects');
    });

    it('whenHidden_tabsItBesideItsUsualNeighbour', () => {
      const agentStack: StackNode | null = findStackOfPanel(dockState.layout(), 'agent');
      dockState.removeFromLayout('properties');
      const reveal: ReturnType<typeof vi.spyOn> = vi.spyOn(dockReveal, 'reveal');

      view.togglePanel('properties');

      const stack: StackNode | null = findStackOfPanel(dockState.layout(), 'properties');
      expect(stack?.id).toBe(agentStack?.id);
      expect(stack?.panels).toContain('agent');
      expect(reveal).toHaveBeenCalledWith('properties');
    });

    it('whenHiddenWithoutItsNeighbour_docksItOnItsUsualEdge', () => {
      dockState.removeFromLayout('properties');
      dockState.removeFromLayout('agent');
      const dockEdge: ReturnType<typeof vi.spyOn> = vi.spyOn(dockState, 'dockEdge');

      view.togglePanel('agent');

      expect(dockEdge).toHaveBeenCalledWith('agent', 'right');
      expect(collectPanelIds(dockState.layout())).toContain('agent');
    });

    it('whenTheTerminalIsHidden_docksItUnderTheWell', () => {
      const dockEdge: ReturnType<typeof vi.spyOn> = vi.spyOn(dockState, 'dockEdge');
      const reveal: ReturnType<typeof vi.spyOn> = vi.spyOn(dockReveal, 'reveal');

      view.togglePanel('terminal');

      expect(dockEdge).toHaveBeenCalledWith('terminal', 'bottom');
      expect(collectPanelIds(dockState.layout())).toContain('terminal');
      expect(reveal).toHaveBeenCalledWith('terminal');
    });

    it('whenTheObjectExplorerIsHidden_docksItOnTheLeft', () => {
      dockState.removeFromLayout('objects');
      const dockEdge: ReturnType<typeof vi.spyOn> = vi.spyOn(dockState, 'dockEdge');

      view.togglePanel('objects');

      expect(dockEdge).toHaveBeenCalledWith('objects', 'left');
    });

    it('twice_onAHiddenPanel_showsThenClosesIt', async () => {
      view.togglePanel('terminal');
      expect(openPanels()['terminal']).toBe(true);

      view.togglePanel('terminal');
      await fixture.whenStable();

      expect(openPanels()['terminal']).toBe(false);
    });
  });

  describe('terminal root', () => {
    it('withAnUntitledDocument_isNull', () => {
      expect(tabContext.root()).toBeNull();
    });

    it('withASavedDocument_isTheDocumentsFolder', () => {
      workspace.filePath.set('/home/ada/shop/queries.studiodb');
      TestBed.tick();

      expect(tabContext.root()).toBe('/home/ada/shop');
    });

    it('whenTheDocumentIsSavedElsewhere_follows', () => {
      workspace.filePath.set('/home/ada/shop/queries.studiodb');
      TestBed.tick();
      workspace.filePath.set('/srv/reports/monthly.studiodb');
      TestBed.tick();

      expect(tabContext.root()).toBe('/srv/reports');
    });
  });

  it('commands_whenTheViewIsDestroyed_areCleared', () => {
    workspace.connections.set([connection('c1', 'Production')]);
    workspace.selection.set({ kind: 'connection', connectionId: 'c1' });
    const commands: DatabaseExplorerCommands = TestBed.inject(DatabaseExplorerCommands);

    fixture.destroy();

    const target: ConnectionTarget | null = commands.connectionTarget();
    expect(target).toBeNull();
  });
});
