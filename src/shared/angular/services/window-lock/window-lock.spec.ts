import { TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
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

  it('locked_whenTheSwitchIsHiddenWhileLocked_releasesTheWindow', () => {
    const settings: Settings = TestBed.inject(Settings);
    windowLock.setLocked(true);
    TestBed.tick();

    settings.set('application.showWindowLock', false);
    TestBed.tick();

    expect(windowLock.locked()).toBe(false);
    expect(movableCalls).toEqual([false, true]);

    // The store outlives the injector, so leaving the switch hidden would carry into the next test.
    settings.set('application.showWindowLock', true);
  });

  it('toggle_whenCalledRepeatedly_flipsLockAndMovabilityTogether', () => {
    windowLock.toggle();
    expect(windowLock.locked()).toBe(true);

    windowLock.toggle();
    expect(windowLock.locked()).toBe(false);
    expect(movableCalls).toEqual([false, true]);
  });
});
