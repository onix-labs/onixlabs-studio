import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FullScreen } from '@shared/angular/services/full-screen/full-screen';
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

describe('TitleStripContainer in full screen', () => {
  it('windowLock_whileTheWindowIsInFullScreen_isNotCarriedByTheStrip', async () => {
    localStorage.clear();
    const fullScreen: ReturnType<typeof signal<boolean>> = signal<boolean>(true);
    await TestBed.configureTestingModule({
      imports: [TitleStripContainer],
      providers: [{ provide: FullScreen, useValue: { active: fullScreen } }],
    }).compileComponents();
    const fixture: ComponentFixture<TitleStripContainer> =
      TestBed.createComponent(TitleStripContainer);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.window-lock')).toBeNull();

    // Leaving full screen brings the switch back.
    fullScreen.set(false);
    await fixture.whenStable();
    expect(host.querySelector('.window-lock')).not.toBeNull();
  });
});
