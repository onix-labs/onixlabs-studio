import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tabs } from '@shared/angular/services/tabs/tabs';
import { WelcomeModal } from '@shared/angular/services/welcome-modal/welcome-modal';
import { WelcomeScreen } from './welcome-screen';

describe('WelcomeScreen', () => {
  let fixture: ComponentFixture<WelcomeScreen>;
  let host: HTMLElement;
  let tabs: Tabs;
  let modal: WelcomeModal;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WelcomeScreen],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeScreen);
    host = fixture.nativeElement as HTMLElement;
    tabs = TestBed.inject(Tabs);
    modal = TestBed.inject(WelcomeModal);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('coldStart_whenNoTabs_isVisibleWithItsGlow', () => {
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.welcome__glow')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__glow-blob').length).toBe(2);
  });

  it('withTabs_whenModalClosed_isNotVisible', () => {
    tabs.open('terminal');
    fixture.detectChanges();

    expect(host.querySelector('.modal--visible')).toBeNull();
  });

  it('withTabs_whenModalOpen_isVisibleAndLooksTheSame', () => {
    tabs.open('terminal');
    modal.open();
    fixture.detectChanges();

    // Summoned over tabs it is the same window with the same treatment; only its role differs.
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.welcome__glow')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__glow-blob').length).toBe(2);
  });
});
