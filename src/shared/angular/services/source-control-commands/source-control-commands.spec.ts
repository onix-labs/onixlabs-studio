import { TestBed } from '@angular/core/testing';

import { SourceControlCommandHandler, SourceControlCommands } from './source-control-commands';

/**
 * Builds a handler that records the name of each command invoked on it.
 * @param calls The array invocation names are pushed to.
 * @returns Returns the recording handler.
 */
function createRecordingHandler(calls: string[]): SourceControlCommandHandler {
  return {
    refresh: (): void => {
      calls.push('refresh');
    },
    fetch: (): void => {
      calls.push('fetch');
    },
    pull: (): void => {
      calls.push('pull');
    },
    push: (): void => {
      calls.push('push');
    },
    stageAll: (): void => {
      calls.push('stageAll');
    },
    commit: (): void => {
      calls.push('commit');
    },
    stash: (): void => {
      calls.push('stash');
    },
    newBranch: (): void => {
      calls.push('newBranch');
    },
    toggleInlineDiff: (): void => {
      calls.push('toggleInlineDiff');
    },
    openAsWorkspace: (): void => {
      calls.push('openAsWorkspace');
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

    commands.refresh();
    commands.fetch();
    commands.pull();
    commands.push();
    commands.stageAll();
    commands.commit();
    commands.stash();
    commands.newBranch();
    commands.toggleInlineDiff();
    commands.openAsWorkspace();

    expect(calls).toEqual([
      'refresh',
      'fetch',
      'pull',
      'push',
      'stageAll',
      'commit',
      'stash',
      'newBranch',
      'toggleInlineDiff',
      'openAsWorkspace',
    ]);
  });

  it('commands_whenNoHandlerRegistered_areNoOps', () => {
    expect((): void => {
      commands.refresh();
      commands.commit();
      commands.openAsWorkspace();
    }).not.toThrow();
  });

  it('unregister_whenGivenTheCurrentHandler_clearsIt', () => {
    const calls: string[] = [];
    const handler: SourceControlCommandHandler = createRecordingHandler(calls);
    commands.register(handler);

    commands.unregister(handler);
    commands.refresh();

    expect(commands.hasActiveRepository()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('unregister_whenGivenADifferentHandler_keepsTheCurrentOne', () => {
    const calls: string[] = [];
    commands.register(createRecordingHandler(calls));

    commands.unregister(createRecordingHandler([]));
    commands.refresh();

    expect(commands.hasActiveRepository()).toBe(true);
    expect(calls).toEqual(['refresh']);
  });
});
