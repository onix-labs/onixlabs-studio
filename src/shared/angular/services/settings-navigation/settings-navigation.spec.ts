import { TestBed } from '@angular/core/testing';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { SettingsNavigation } from './settings-navigation';

describe('SettingsNavigation', () => {
  let navigation: SettingsNavigation;
  let opened: string[];

  beforeEach(() => {
    opened = [];
    TestBed.configureTestingModule({
      providers: [{ provide: Tabs, useValue: { open: (id: string): number => opened.push(id) } }],
    });
    navigation = TestBed.inject(SettingsNavigation);
  });

  it('open_opensSettings_andRequestsTheSection', () => {
    navigation.open('notifications');

    expect(opened).toEqual(['settings']);
    expect(navigation.requestedSection()).toBe('notifications');
    expect(navigation.takeFocus()).toBeNull();
  });

  it('open_withARow_holdsItForTheSectionToTakeOnce (#1487)', () => {
    navigation.open('notifications', 'containers.exited');
    navigation.consume();

    // The view consumes the section before the section's content renders; the row outlives that.
    expect(navigation.takeFocus()).toBe('containers.exited');
    expect(navigation.takeFocus()).toBeNull();
  });

  it('open_withoutARow_clearsOneLeftOver', () => {
    navigation.open('notifications', 'containers.exited');
    navigation.open('application');

    expect(navigation.takeFocus()).toBeNull();
  });
});
