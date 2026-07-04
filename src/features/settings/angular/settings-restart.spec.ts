import { TestBed } from '@angular/core/testing';

import { Display } from '@shared/angular/services/display/display';
import { SettingsRestart } from '@features/settings/angular/settings-restart';

describe('SettingsRestart', () => {
  let restart: SettingsRestart;
  let display: Display;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    restart = TestBed.inject(SettingsRestart);
    display = TestBed.inject(Display);
  });

  it('restartRequired_whenNoChangePending_isFalse', () => {
    expect(restart.restartRequired()).toBe(false);
  });

  it('restartRequired_whenRestartGatedSettingChanges_becomesTrue', () => {
    display.setHardwareAcceleration(false);
    expect(restart.restartRequired()).toBe(true);
  });
});
