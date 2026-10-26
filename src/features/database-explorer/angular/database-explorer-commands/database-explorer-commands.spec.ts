import { beforeEach, describe, expect, it } from 'vitest';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import {
  ConnectionTarget,
  DatabaseExplorerCommandHandler,
  DatabaseExplorerCommands,
  RibbonPanel,
} from './database-explorer-commands';

/**
 * A handler recording every command it is given, with writable state for the ribbon to read.
 */
class RecordingHandler implements DatabaseExplorerCommandHandler {
  /**
   * Holds every command the handler ran, in order.
   */
  public readonly calls: string[] = [];

  public readonly canExecute: WritableSignal<boolean> = signal<boolean>(false);
  public readonly executing: WritableSignal<boolean> = signal<boolean>(false);
  public readonly connectionTarget: WritableSignal<ConnectionTarget | null> =
    signal<ConnectionTarget | null>(null);
  public readonly panels: WritableSignal<readonly RibbonPanel[]> = signal<readonly RibbonPanel[]>(
    [],
  );
  public readonly hasPassphrase: WritableSignal<boolean> = signal<boolean>(false);
  public readonly locked: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Records an execute.
   */
  public execute(): void {
    this.calls.push('execute');
  }

  /**
   * Records a new query.
   */
  public newQuery(): void {
    this.calls.push('newQuery');
  }

  /**
   * Records a new connection.
   */
  public newConnection(): void {
    this.calls.push('newConnection');
  }

  /**
   * Records a save.
   */
  public saveDocument(): void {
    this.calls.push('save');
  }

  /**
   * Records a save-as.
   */
  public saveDocumentAs(): void {
    this.calls.push('saveAs');
  }

  /**
   * Records a layout reset.
   */
  public resetLayout(): void {
    this.calls.push('resetLayout');
  }

  /**
   * Records a connect or disconnect.
   */
  public toggleConnection(): void {
    this.calls.push('toggleConnection');
  }

  /**
   * Records a connection refresh.
   */
  public refreshConnection(): void {
    this.calls.push('refreshConnection');
  }

  /**
   * Records a connection edit.
   */
  public editConnection(): void {
    this.calls.push('editConnection');
  }

  /**
   * Records a panel toggle.
   * @param id The panel's id.
   */
  public togglePanel(id: string): void {
    this.calls.push(`togglePanel:${id}`);
  }

  /**
   * Records a passphrase being set.
   */
  public setPassphrase(): void {
    this.calls.push('setPassphrase');
  }

  /**
   * Records a passphrase being removed.
   */
  public removePassphrase(): void {
    this.calls.push('removePassphrase');
  }

  /**
   * Records an unlock.
   */
  public unlockPassphrase(): void {
    this.calls.push('unlockPassphrase');
  }
}

/**
 * Runs every command the registry forwards.
 * @param commands The registry.
 */
function runEveryCommand(commands: DatabaseExplorerCommands): void {
  commands.execute();
  commands.newQuery();
  commands.newConnection();
  commands.saveDocument();
  commands.saveDocumentAs();
  commands.resetLayout();
  commands.toggleConnection();
  commands.refreshConnection();
  commands.editConnection();
  commands.togglePanel('objects');
  commands.setPassphrase();
  commands.removePassphrase();
  commands.unlockPassphrase();
}

describe('DatabaseExplorerCommands', () => {
  let commands: DatabaseExplorerCommands;
  let handler: RecordingHandler;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    commands = TestBed.inject(DatabaseExplorerCommands);
    handler = new RecordingHandler();
  });

  it('state_withNoHandler_readsAsNothingToActOn', () => {
    expect(commands.canExecute()).toBe(false);
    expect(commands.executing()).toBe(false);
    expect(commands.connectionTarget()).toBeNull();
    expect(commands.panels()).toEqual([]);
    expect(commands.hasPassphrase()).toBe(false);
    expect(commands.locked()).toBe(false);
  });

  it('commands_withNoHandler_doNothing', () => {
    expect((): void => runEveryCommand(commands)).not.toThrow();
  });

  it('state_withAHandler_followsTheHandlersSignals', () => {
    commands.register(handler);
    const target: ConnectionTarget = { id: 'c1', name: 'Production', state: 'open' };
    const panels: readonly RibbonPanel[] = [
      { id: 'objects', title: 'Object Explorer', icon: Icon.DATABASE_OBJECTS, open: true },
    ];

    handler.canExecute.set(true);
    handler.executing.set(true);
    handler.connectionTarget.set(target);
    handler.panels.set(panels);
    handler.hasPassphrase.set(true);
    handler.locked.set(true);

    expect(commands.canExecute()).toBe(true);
    expect(commands.executing()).toBe(true);
    expect(commands.connectionTarget()).toBe(target);
    expect(commands.panels()).toBe(panels);
    expect(commands.hasPassphrase()).toBe(true);
    expect(commands.locked()).toBe(true);
  });

  it('commands_withAHandler_forwardEachToIt', () => {
    commands.register(handler);

    runEveryCommand(commands);

    expect(handler.calls).toEqual([
      'execute',
      'newQuery',
      'newConnection',
      'save',
      'saveAs',
      'resetLayout',
      'toggleConnection',
      'refreshConnection',
      'editConnection',
      'togglePanel:objects',
      'setPassphrase',
      'removePassphrase',
      'unlockPassphrase',
    ]);
  });

  it('register_aSecondHandler_replacesTheFirst', () => {
    const second: RecordingHandler = new RecordingHandler();
    commands.register(handler);
    commands.register(second);

    commands.toggleConnection();

    expect(handler.calls).toEqual([]);
    expect(second.calls).toEqual(['toggleConnection']);
  });

  it('clear_withTheRegisteredHandler_leavesNothingToDrive', () => {
    commands.register(handler);
    handler.connectionTarget.set({ id: 'c1', name: 'Production', state: 'closed' });

    commands.clear(handler);
    commands.toggleConnection();

    expect(commands.connectionTarget()).toBeNull();
    expect(handler.calls).toEqual([]);
  });

  it('clear_withAStaleHandler_keepsTheCurrentOne', () => {
    // A view destroyed after its replacement registered must not unhook the replacement.
    const current: RecordingHandler = new RecordingHandler();
    commands.register(handler);
    commands.register(current);

    commands.clear(handler);
    commands.togglePanel('terminal');

    expect(current.calls).toEqual(['togglePanel:terminal']);
  });
});
