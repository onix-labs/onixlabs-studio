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
 * Builds the service over a session whose rename and branch delete answer as given, recording the
 * notifications.
 * @param rename What the session's rename does.
 * @param deleteBranch What the session's branch delete does; the rename's answer when not given.
 * @param createBranch What the session's branch create does; the rename's answer when not given.
 * @returns Returns the service and the notifications it raised.
 */
function serviceWith(
  rename: () => Promise<WorktreeOutcome<null>>,
  deleteBranch: () => Promise<WorktreeOutcome<null>> = rename,
  createBranch: () => Promise<WorktreeOutcome<null>> = rename,
): {
  service: WorktreeRepository;
  raised: NotificationRequest[];
} {
  const raised: NotificationRequest[] = [];
  TestBed.configureTestingModule({
    providers: [
      WorktreeRepository,
      { provide: WorktreeSession, useValue: { rename, deleteBranch, createBranch } },
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

describe('WorktreeRepository.deleteBranch', () => {
  it('saysDeleted_andNothingElse_whenTheDeleteSucceeds', async () => {
    const { service, raised } = serviceWith(() => Promise.resolve({ ok: true, value: null }));

    expect(await service.deleteBranch('w2', 'old', false)).toBe('deleted');
    expect(raised).toEqual([]);
  });

  it('handsUnmergedCommitsBackAsAQuestion_ratherThanReportingThem', async () => {
    // The panel asks whether to lose the work; a notification as well would say it twice.
    const { service, raised } = serviceWith(() =>
      Promise.resolve(worktreeError('not fully merged', 'branch-not-merged')),
    );

    expect(await service.deleteBranch('w2', 'old', false)).toBe('not-merged');
    expect(raised).toEqual([]);
  });

  it('reportsAnyOtherFailure', async () => {
    const { service, raised } = serviceWith(() =>
      Promise.resolve(worktreeError('"feat/x" is checked out in that worktree.')),
    );

    expect(await service.deleteBranch('w2', 'feat/x', false)).toBe('failed');
    expect(raised[0].title).toBe('Could not delete feat/x');
    expect(raised[0].detail).toBe('"feat/x" is checked out in that worktree.');
  });
});

describe('WorktreeRepository.createBranch', () => {
  it('reportsAFailure_andSaysTheBranchWasNotMade', async () => {
    const { service, raised } = serviceWith(() =>
      Promise.resolve(worktreeError("a branch named 'fresh' already exists")),
    );

    expect(await service.createBranch('w2', 'fresh', true)).toBe(false);
    expect(raised[0].title).toBe('Could not create fresh');
  });
});
