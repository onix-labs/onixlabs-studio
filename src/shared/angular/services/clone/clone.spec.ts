import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { CloneChannel, CloneOutcome, CloneRequest } from '@shared/api/clone-channels';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';

import { Clone } from './clone';

/**
 * The clone every test asks for.
 */
const REQUEST: CloneRequest = {
  url: 'https://github.com/onix-labs/shop.git',
  name: 'shop',
  layout: 'flat',
  submodules: false,
  shallow: false,
};

describe('Clone (#1493)', () => {
  let outcome: CloneOutcome;
  let invoke: ReturnType<typeof vi.fn>;
  let raised: NotificationRequest[];
  let openDirectoryPath: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    outcome = { ok: true, path: '/Users/me/Code/shop' };
    invoke = vi.fn((): Promise<CloneOutcome> => Promise.resolve(outcome));
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke,
      send: vi.fn(),
      on: vi.fn((): (() => void) => (): void => undefined),
    } as unknown as Bridge;
    raised = [];
    openDirectoryPath = vi.fn((): Promise<boolean> => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Notifications,
          useValue: { notify: (request: NotificationRequest): void => void raised.push(request) },
        },
        { provide: FileOpener, useValue: { openDirectoryPath } },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('aFinishedClone_saysSo_withOpen', async () => {
    const clone: Clone = TestBed.inject(Clone);

    expect(await clone.clone(REQUEST)).toEqual(outcome);

    expect(invoke).toHaveBeenCalledWith(CloneChannel.Clone, REQUEST);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      severity: 'success',
      title: 'Cloned shop',
      type: 'clone.finished',
      desktop: true,
    });
    raised[0].actions?.[0].run();
    expect(openDirectoryPath).toHaveBeenCalledWith('/Users/me/Code/shop');
  });

  it('aFailedClone_saysWhy_andStays', async () => {
    outcome = { ok: false, error: 'Repository not found.' };
    const clone: Clone = TestBed.inject(Clone);

    await clone.clone(REQUEST);

    expect(raised[0]).toMatchObject({
      severity: 'error',
      title: "Couldn't clone shop",
      detail: 'Repository not found.',
      sticky: true,
      type: 'clone.failed',
    });
  });

  it('aCloneOfAnUnknownSshHost_saysWhatToRun_andKeepsGitsOwnWords (#1255)', async () => {
    outcome = {
      ok: false,
      error: "SSH doesn't know github.com's host key yet. (the plugin's English)",
      code: 'ssh-host-unknown',
      sshHost: { host: 'github.com' },
      output: 'Host key verification failed.',
    };
    const clone: Clone = TestBed.inject(Clone);

    await clone.clone(REQUEST);

    expect(raised[0]).toMatchObject({
      severity: 'error',
      title: "Couldn't clone shop",
      commands: ['ssh -T git@github.com', 'ssh-keyscan github.com >> ~/.ssh/known_hosts'],
      output: 'Host key verification failed.',
    });
    expect(raised[0].detail).toContain('the host key of github.com');
  });

  it('aCloneTheUserCancelled_raisesNothing (#1504)', async () => {
    outcome = { ok: false, error: 'The clone was cancelled.', cancelled: true };
    const clone: Clone = TestBed.inject(Clone);

    expect(await clone.clone(REQUEST)).toEqual(outcome);
    expect(raised).toEqual([]);
  });

  it('outsideTheDesktopApp_clonesNothing_andRaisesNothing', async () => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
    const clone: Clone = TestBed.inject(Clone);

    expect(await clone.clone(REQUEST)).toEqual({
      ok: false,
      error: 'Cloning is unavailable outside the desktop application.',
    });
    expect(raised).toEqual([]);
  });
});
