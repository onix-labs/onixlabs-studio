import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  WorkspaceSourceControlCommandHandler,
  WorkspaceSourceControlCommands,
} from './workspace-source-control-commands';

/**
 * Builds a handler that records the name of each command invoked on it.
 * @param calls The array invocation names are pushed to.
 * @param hasRepository The signal backing the handler's repository flag.
 * @returns Returns the recording handler.
 */
function createRecordingHandler(
  calls: string[],
  hasRepository: WritableSignal<boolean>,
): WorkspaceSourceControlCommandHandler {
  return {
    hasRepository,
    openInSourceControl: (): void => {
      calls.push('openInSourceControl');
    },
    commit: (): void => {
      calls.push('commit');
    },
    push: (): void => {
      calls.push('push');
    },
    pull: (): void => {
      calls.push('pull');
    },
  };
}

describe('WorkspaceSourceControlCommands', () => {
  let commands: WorkspaceSourceControlCommands;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WorkspaceSourceControlCommands] });
    commands = TestBed.inject(WorkspaceSourceControlCommands);
  });

  it('hasRepository_whenNoHandlerRegistered_isFalse', () => {
    expect(commands.hasRepository()).toBe(false);
  });

  it('hasRepository_whenHandlerRegistered_followsTheHandlersSignal', () => {
    const hasRepository: WritableSignal<boolean> = signal<boolean>(true);
    commands.register(createRecordingHandler([], hasRepository));

    expect(commands.hasRepository()).toBe(true);

    hasRepository.set(false);

    expect(commands.hasRepository()).toBe(false);
  });

  it('commands_whenHandlerRegistered_forwardToTheHandler', () => {
    const calls: string[] = [];
    commands.register(createRecordingHandler(calls, signal<boolean>(true)));

    commands.openInSourceControl();
    commands.commit();
    commands.push();
    commands.pull();

    expect(calls).toEqual(['openInSourceControl', 'commit', 'push', 'pull']);
  });

  it('commands_whenNoHandlerRegistered_areNoOps', () => {
    expect((): void => {
      commands.openInSourceControl();
      commands.commit();
      commands.push();
      commands.pull();
    }).not.toThrow();
  });

  it('unregister_whenGivenTheCurrentHandler_clearsIt', () => {
    const calls: string[] = [];
    const handler: WorkspaceSourceControlCommandHandler = createRecordingHandler(
      calls,
      signal<boolean>(true),
    );
    commands.register(handler);

    commands.unregister(handler);
    commands.commit();

    expect(commands.hasRepository()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('unregister_whenGivenADifferentHandler_keepsTheCurrentOne', () => {
    const calls: string[] = [];
    commands.register(createRecordingHandler(calls, signal<boolean>(true)));

    commands.unregister(createRecordingHandler([], signal<boolean>(false)));
    commands.commit();

    expect(commands.hasRepository()).toBe(true);
    expect(calls).toEqual(['commit']);
  });
});
