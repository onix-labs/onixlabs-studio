import { TestBed } from '@angular/core/testing';

import { Studio } from '@shared/angular/services/studio/studio';
import { WindowLock } from './window-lock';

describe('WindowLock', () => {
  let windowLock: WindowLock;
  let movableCalls: boolean[];

  beforeEach(() => {
    movableCalls = [];
    const studioStub: Pick<Studio, 'setWindowMovable'> = {
      setWindowMovable: (movable: boolean): void => {
        movableCalls.push(movable);
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Studio, useValue: studioStub }],
    });
    windowLock = TestBed.inject(WindowLock);
  });

  it('locked_beforeAnyInteraction_isFalse', () => {
    expect(windowLock.locked()).toBe(false);
  });

  it('setLocked_whenLocking_pinsTheWindow', () => {
    windowLock.setLocked(true);

    expect(windowLock.locked()).toBe(true);
    expect(movableCalls).toEqual([false]);
  });

  it('setLocked_whenUnlocking_releasesTheWindow', () => {
    windowLock.setLocked(true);

    windowLock.setLocked(false);

    expect(windowLock.locked()).toBe(false);
    expect(movableCalls).toEqual([false, true]);
  });

  it('toggle_whenCalledRepeatedly_flipsLockAndMovabilityTogether', () => {
    windowLock.toggle();
    expect(windowLock.locked()).toBe(true);

    windowLock.toggle();
    expect(windowLock.locked()).toBe(false);
    expect(movableCalls).toEqual([false, true]);
  });
});
