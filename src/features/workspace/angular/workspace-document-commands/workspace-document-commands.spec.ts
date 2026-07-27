import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  WorkspaceDocumentCommandHandler,
  WorkspaceDocumentCommands,
} from './workspace-document-commands';

/**
 * A recording stand-in for a workspace's document well.
 */
class FakeHandler implements WorkspaceDocumentCommandHandler {
  public readonly canSave: WritableSignal<boolean> = signal<boolean>(true);
  public readonly hasUnsavedChanges: WritableSignal<boolean> = signal<boolean>(false);
  public saveCalls: number = 0;
  public saveAllCalls: number = 0;

  public save(): void {
    this.saveCalls++;
  }

  public saveAll(): void {
    this.saveAllCalls++;
  }
}

describe('WorkspaceDocumentCommands', () => {
  let commands: WorkspaceDocumentCommands;
  let handler: FakeHandler;

  beforeEach((): void => {
    TestBed.configureTestingModule({});
    commands = TestBed.inject(WorkspaceDocumentCommands);
    handler = new FakeHandler();
  });

  it('withNoHandler_reportsNothingToSave_andCommandsAreSafeNoOps', (): void => {
    expect(commands.canSave()).toBe(false);
    expect(commands.hasUnsavedChanges()).toBe(false);

    expect((): void => commands.save()).not.toThrow();
    expect((): void => commands.saveAll()).not.toThrow();
  });

  it('register_forwardsTheCommandsAndMirrorsTheHandlersState', (): void => {
    commands.register(handler);

    expect(commands.canSave()).toBe(true);
    expect(commands.hasUnsavedChanges()).toBe(false);

    handler.hasUnsavedChanges.set(true);
    expect(commands.hasUnsavedChanges()).toBe(true);

    commands.save();
    commands.saveAll();
    expect(handler.saveCalls).toBe(1);
    expect(handler.saveAllCalls).toBe(1);
  });

  it('unregister_onlyClearsTheHandlerItWasGiven', (): void => {
    const other: FakeHandler = new FakeHandler();
    commands.register(handler);

    // A tab deactivating after another has already taken over must not clear the newcomer.
    commands.register(other);
    commands.unregister(handler);
    commands.save();
    expect(other.saveCalls).toBe(1);
    expect(handler.saveCalls).toBe(0);

    commands.unregister(other);
    expect(commands.canSave()).toBe(false);
  });
});
