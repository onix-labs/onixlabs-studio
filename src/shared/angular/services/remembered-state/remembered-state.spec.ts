import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RememberedState } from './remembered-state';

describe('RememberedState', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('acrossLaunches_whenNothingIsRemembered_startsFromTheFallback', () => {
    const value: WritableSignal<boolean> = TestBed.inject(RememberedState).acrossLaunches(
      'test.flag',
      true,
    );

    expect(value()).toBe(true);
  });

  it('acrossLaunches_writesChangesBack_andReadsThemNextLaunch', () => {
    TestBed.inject(RememberedState).acrossLaunches('test.flag', false).set(true);
    TestBed.tick();
    TestBed.resetTestingModule();

    expect(TestBed.inject(RememberedState).acrossLaunches('test.flag', false)()).toBe(true);
  });

  it('acrossLaunches_sharesOneValuePerKey', () => {
    const state: RememberedState = TestBed.inject(RememberedState);

    expect(state.acrossLaunches('test.flag', false)).toBe(state.acrossLaunches('test.flag', false));
  });

  it('forSession_isNotPersisted', () => {
    TestBed.inject(RememberedState).forSession('test.filter', 'open').set('all');
    TestBed.tick();
    TestBed.resetTestingModule();

    expect(TestBed.inject(RememberedState).forSession('test.filter', 'open')()).toBe('open');
  });
});
