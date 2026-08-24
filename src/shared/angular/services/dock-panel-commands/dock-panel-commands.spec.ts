import { signal, Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DockPanelCommandHandler, DockPanelCommands, DockPanelState } from './dock-panel-commands';

/**
 * A recording stand-in for a dock-hosting view's panel handler.
 */
class FakeHandler implements DockPanelCommandHandler {
  /**
   * Holds the panels this handler offers.
   */
  public readonly states: WritableSignal<readonly DockPanelState[]>;

  /**
   * Holds the identifiers toggled through this handler, in order.
   */
  public readonly toggled: string[] = [];

  /**
   * Initializes a new instance of the {@link FakeHandler} class.
   * @param states The panels the handler starts with.
   */
  public constructor(states: readonly DockPanelState[] = []) {
    this.states = signal<readonly DockPanelState[]>(states);
  }

  /**
   * Gets the panels this handler offers.
   */
  public get panels(): Signal<readonly DockPanelState[]> {
    return this.states;
  }

  /**
   * Records a toggle.
   * @param panelId The identifier of the panel toggled.
   */
  public toggle(panelId: string): void {
    this.toggled.push(panelId);
  }
}

/**
 * Builds a panel state.
 * @param id The panel identifier.
 * @param docked Whether the panel is showing.
 * @returns Returns the state.
 */
function panel(id: string, docked: boolean = false): DockPanelState {
  return { id, title: id, docked, enabled: true };
}

describe('DockPanelCommands', () => {
  let commands: DockPanelCommands;

  beforeEach(() => {
    commands = TestBed.inject(DockPanelCommands);
  });

  it('listsNothing_untilAViewRegisters', () => {
    expect(commands.panels()).toEqual([]);
  });

  it('listsTheRegisteredViewsPanels_andTracksThemLive', () => {
    const handler: FakeHandler = new FakeHandler([panel('files', true)]);
    commands.register(handler);

    expect(commands.panels()).toEqual([panel('files', true)]);

    handler.states.set([panel('files', true), panel('agent')]);

    expect(commands.panels().map((state: DockPanelState): string => state.id)).toEqual([
      'files',
      'agent',
    ]);
  });

  it('toggle_reachesTheRegisteredHandler', () => {
    const handler: FakeHandler = new FakeHandler([panel('agent')]);
    commands.register(handler);

    commands.toggle('agent');

    expect(handler.toggled).toEqual(['agent']);
  });

  it('toggle_withNoViewRegistered_isIgnored', () => {
    expect((): void => commands.toggle('agent')).not.toThrow();
  });

  it('register_replacesTheOutgoingView_soTheMenuFollowsTheActiveTab', () => {
    const first: FakeHandler = new FakeHandler([panel('files')]);
    const second: FakeHandler = new FakeHandler([panel('history')]);
    commands.register(first);
    commands.register(second);

    commands.toggle('history');

    expect(commands.panels().map((state: DockPanelState): string => state.id)).toEqual(['history']);
    expect(first.toggled).toEqual([]);
    expect(second.toggled).toEqual(['history']);
  });

  it('unregister_byAnOvertakenHandler_leavesTheCurrentOneAlone', () => {
    // A view destroyed after its successor registered must not clear the successor's registration,
    // or the menu would empty out on a tab swap.
    const outgoing: FakeHandler = new FakeHandler([panel('files')]);
    const incoming: FakeHandler = new FakeHandler([panel('history')]);
    commands.register(outgoing);
    commands.register(incoming);

    commands.unregister(outgoing);

    expect(commands.panels().map((state: DockPanelState): string => state.id)).toEqual(['history']);
  });

  it('unregister_byTheCurrentHandler_emptiesTheList', () => {
    const handler: FakeHandler = new FakeHandler([panel('files')]);
    commands.register(handler);

    commands.unregister(handler);

    expect(commands.panels()).toEqual([]);
  });
});
