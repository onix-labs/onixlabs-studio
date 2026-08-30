import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { TitleStripContainer } from './title-strip-container';

describe('TitleStripContainer', () => {
  let component: TitleStripContainer;
  let fixture: ComponentFixture<TitleStripContainer>;

  beforeEach(async () => {
    // Settings persist in localStorage, which outlives every TestBed injector: a switch another spec
    // left hidden would otherwise decide this file's default-state assertion.
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TitleStripContainer],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripContainer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Reads the window-lock switch from the rendered strip.
   * @returns Returns the switch, or null when the strip does not carry it.
   */
  function windowLockSwitch(): HTMLElement | null {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    return host.querySelector<HTMLElement>('.window-lock');
  }

  it('windowLock_byDefault_isCarriedByTheStrip', () => {
    expect(windowLockSwitch()).not.toBeNull();
  });

  it('windowLock_whenTheSettingIsOff_isNotCarriedByTheStrip', async () => {
    const settings: Settings = TestBed.inject(Settings);

    settings.set('application.showWindowLock', false);
    await fixture.whenStable();

    expect(windowLockSwitch()).toBeNull();
  });

  afterEach(() => {
    localStorage.clear();
  });
});
