import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  Notifications,
  NotificationRequest,
} from '@shared/angular/services/notifications/notifications';
import { worktreeError, WorktreeOutcome } from '@shared/api/worktree';
import { WorktreeRepository } from './worktree-repository';
import { WorktreeSession } from './worktree-session';

/**
 * Builds the service over a session whose rename answers as given, recording the notifications.
 * @param rename What the session's rename does.
 * @returns Returns the service and the notifications it raised.
 */
function serviceWith(rename: () => Promise<WorktreeOutcome<null>>): {
  service: WorktreeRepository;
  raised: NotificationRequest[];
} {
  const raised: NotificationRequest[] = [];
  TestBed.configureTestingModule({
    providers: [
      WorktreeRepository,
      { provide: WorktreeSession, useValue: { rename } },
      {
        provide: Notifications,
        useValue: { notify: (request: NotificationRequest): number => raised.push(request) },
      },
    ],
  });
  return { service: TestBed.inject(WorktreeRepository), raised };
}

/**
 * Lets the rename's promise chain settle.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('WorktreeRepository.rename', () => {
  it('saysNothing_whenTheRenameSucceeds', async () => {
    const { service, raised } = serviceWith(() => Promise.resolve({ ok: true, value: null }));

    service.rename('w1', 'default');
    await settle();

    expect(raised).toEqual([]);
  });

  it('reportsARefusal', async () => {
    const { service, raised } = serviceWith(() =>
      Promise.resolve(worktreeError('The checkout is not registered in this container.')),
    );

    service.rename('w1', 'default');
    await settle();

    expect(
      raised.map((request: NotificationRequest): string | undefined => request.detail),
    ).toEqual(['The checkout is not registered in this container.']);
  });

  it('reportsACallThatNeverReachedTheMainProcess', async () => {
    // A main process older than the renderer has no handler for the channel: the call rejects, and a
    // rename that silently did nothing was exactly what the user saw.
    const { service, raised } = serviceWith(() =>
      Promise.reject(new Error("No handler registered for 'worktree:rename-checkout'")),
    );

    service.rename('w1', 'default');
    await settle();

    expect(raised).toHaveLength(1);
    expect(raised[0].title).toBe('Could not rename the worktree');
    expect(raised[0].detail).toContain('No handler registered');
  });
});
