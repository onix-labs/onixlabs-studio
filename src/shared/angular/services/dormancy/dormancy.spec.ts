import { TestBed } from '@angular/core/testing';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Dormancy } from './dormancy';

describe('Dormancy', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('sleep_thenWake_endsTheDormancy', () => {
    const dormancy: Dormancy = TestBed.inject(Dormancy);

    dormancy.sleep();
    expect(dormancy.dormant()).toBe(true);
    dormancy.wake();

    expect(dormancy.dormant()).toBe(false);
  });

  it('openingATab_wakesStudio', () => {
    const dormancy: Dormancy = TestBed.inject(Dormancy);
    dormancy.sleep();

    TestBed.inject(Tabs).open('settings');
    TestBed.tick();

    expect(dormancy.dormant()).toBe(false);
  });
});
