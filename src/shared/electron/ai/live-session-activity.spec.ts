import { describe, expect, it } from 'vitest';
import type { AiEvent } from '@shared/api/ai-types';
import { liveSessionBusyReason, trackTaskEvent } from './live-session-activity';

describe('trackTaskEvent', () => {
  it('addsAStartedTask_andRemovesItOnItsSettle', () => {
    const tasks: Set<string> = new Set<string>();

    trackTaskEvent(tasks, {
      requestId: 'run-1',
      kind: 'task-started',
      agentSessionId: 'conversation-1',
      taskId: 'task-1',
      description: 'Watch CI',
    });
    expect([...tasks]).toEqual(['task-1']);

    trackTaskEvent(tasks, {
      requestId: 'run-1',
      kind: 'background-task',
      agentSessionId: 'conversation-1',
      taskId: 'task-1',
      status: 'completed',
      summary: 'CI green',
      outputFile: '/tmp/task-1.out',
    });
    expect(tasks.size).toBe(0);
  });

  it('removesATaskOnATerminalPatch_becauseAForegroundTaskNeverSettles', () => {
    const tasks: Set<string> = new Set<string>(['task-1', 'task-2']);

    trackTaskEvent(tasks, {
      requestId: 'run-1',
      kind: 'task-updated',
      agentSessionId: 'conversation-1',
      taskId: 'task-1',
      status: 'killed',
    });
    trackTaskEvent(tasks, {
      requestId: 'run-1',
      kind: 'task-updated',
      agentSessionId: 'conversation-1',
      taskId: 'task-2',
      status: 'running',
    });

    expect([...tasks]).toEqual(['task-2']);
  });

  it('ignoresEveryOtherEvent', () => {
    const tasks: Set<string> = new Set<string>(['task-1']);
    const text: AiEvent = { requestId: 'run-1', kind: 'text', delta: 'hello' };

    trackTaskEvent(tasks, text);

    expect([...tasks]).toEqual(['task-1']);
  });
});

describe('liveSessionBusyReason', () => {
  it('isNull_forASessionWithNothingGoingOn', () => {
    expect(liveSessionBusyReason({ activeTurns: 0, liveTasks: new Set(), promptOpen: false })).toBe(
      null,
    );
  });

  it('isBusy_whileABackgroundTaskRuns_soIdleReapDoesNotKillIt', () => {
    expect(
      liveSessionBusyReason({ activeTurns: 0, liveTasks: new Set(['task-1']), promptOpen: false }),
    ).toBe('1 background task(s) running');
  });

  it('isBusy_whileAPromptWaitsOnTheUser', () => {
    expect(liveSessionBusyReason({ activeTurns: 0, liveTasks: new Set(), promptOpen: true })).toBe(
      'waiting on the user',
    );
  });

  it('isBusy_whileATurnRuns', () => {
    expect(liveSessionBusyReason({ activeTurns: 1, liveTasks: new Set(), promptOpen: false })).toBe(
      'a turn is running',
    );
  });
});
