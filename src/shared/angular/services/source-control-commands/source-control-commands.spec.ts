import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SourceControlCommandHandler, SourceControlCommands } from './source-control-commands';

/**
 * Builds a handler that records the name of each command invoked on it.
 * @param calls The array invocation names are pushed to.
 * @param canPromote Whether the handler reports itself promotable.
 * @returns Returns the recording handler.
 */
function createRecordingHandler(
  calls: string[],
  canPromote: boolean = true,
): SourceControlCommandHandler {
  return {
    fetch: (): void => {
      calls.push('fetch');
    },
    stash: (): void => {
      calls.push('stash');
    },
    canPromoteToWorktree: signal<boolean>(canPromote),
    promoteToWorktree: (): void => {
      calls.push('promoteToWorktree');
    },
  };
}

describe('SourceControlCommands', () => {
  let commands: SourceControlCommands;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SourceControlCommands] });
    commands = TestBed.inject(SourceControlCommands);
  });

  it('hasActiveRepository_whenNoHandlerRegistered_isFalse', () => {
    expect(commands.hasActiveRepository()).toBe(false);
  });

  it('register_whenHandlerRegistered_setsHasActiveRepository', () => {
    commands.register(createRecordingHandler([]));

    expect(commands.hasActiveRepository()).toBe(true);
  });

  it('commands_whenHandlerRegistered_forwardToTheHandler', () => {
    const calls: string[] = [];
    commands.register(createRecordingHandler(calls));

    commands.fetch();
    commands.stash();
    commands.promoteToWorktree();

    expect(calls).toEqual(['fetch', 'stash', 'promoteToWorktree']);
  });

  it('canPromoteToWorktree_mirrorsTheHandler_andIsFalseWithoutOne', () => {
    expect(commands.canPromoteToWorktree()).toBe(false);

    commands.register(createRecordingHandler([], true));
    expect(commands.canPromoteToWorktree()).toBe(true);

    commands.register(createRecordingHandler([], false));
    expect(commands.canPromoteToWorktree()).toBe(false);
  });

  it('commands_whenNoHandlerRegistered_areNoOps', () => {
    expect((): void => {
      commands.fetch();
      commands.stash();
      commands.promoteToWorktree();
    }).not.toThrow();
  });

  it('unregister_whenGivenTheCurrentHandler_clearsIt', () => {
    const calls: string[] = [];
    const handler: SourceControlCommandHandler = createRecordingHandler(calls);
    commands.register(handler);

    commands.unregister(handler);
    commands.fetch();

    expect(commands.hasActiveRepository()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('unregister_whenGivenADifferentHandler_keepsTheCurrentOne', () => {
    const calls: string[] = [];
    commands.register(createRecordingHandler(calls));

    commands.unregister(createRecordingHandler([]));
    commands.fetch();

    expect(commands.hasActiveRepository()).toBe(true);
    expect(calls).toEqual(['fetch']);
  });
});
