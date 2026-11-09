import { Settings } from '@shared/angular/services/settings/settings';
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

  public unsavedFiles: boolean = false;
  public saveFilesCalls: number = 0;

  public hasUnsavedFiles(): boolean {
    return this.unsavedFiles;
  }

  public saveFiles(): Promise<void> {
    this.saveFilesCalls++;
    return Promise.resolve();
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

  describe('afterSaving (#1245)', () => {
    let ran: number;

    /**
     * Counts a run starting.
     */
    function run(): void {
      ran++;
    }

    beforeEach((): void => {
      ran = 0;
      commands.register(handler);
      handler.unsavedFiles = true;
    });

    afterEach((): void => {
      localStorage.removeItem('settings');
    });

    it('always_savesFirst_thenRuns', async (): Promise<void> => {
      commands.afterSaving(run);
      expect(ran).toBe(0);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler.saveFilesCalls).toBe(1);
      expect(ran).toBe(1);
    });

    it('never_runsAtOnce_withoutSaving', (): void => {
      TestBed.inject(Settings).set('workspaces.saveBeforeRun', 'never');

      commands.afterSaving(run);

      expect(handler.saveFilesCalls).toBe(0);
      expect(ran).toBe(1);
    });

    it('nothingToSave_runsAtOnce', (): void => {
      handler.unsavedFiles = false;

      commands.afterSaving(run);

      expect(ran).toBe(1);
    });

    it('ask_waitsForTheAnswer_andCancelRunsNothing', (): void => {
      TestBed.inject(Settings).set('workspaces.saveBeforeRun', 'ask');

      commands.afterSaving(run);
      expect(commands.askingToSave()).toBe(true);
      expect(ran).toBe(0);

      commands.answerSaveQuestion('cancel');
      expect(commands.askingToSave()).toBe(false);
      expect(ran).toBe(0);
    });

    it('ask_dontSave_runsWithoutSaving', (): void => {
      TestBed.inject(Settings).set('workspaces.saveBeforeRun', 'ask');

      commands.afterSaving(run);
      commands.answerSaveQuestion('skip');

      expect(handler.saveFilesCalls).toBe(0);
      expect(ran).toBe(1);
    });
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
