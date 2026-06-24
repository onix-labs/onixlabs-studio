import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tabs } from '../../services/tabs/tabs';
import { WelcomeModal } from '../../services/welcome-modal/welcome-modal';
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

  it('coldStart_whenNoTabs_isVisibleWithAmbientOrbs', () => {
    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.welcome-modal--ambient')).not.toBeNull();
    expect(host.querySelector('.welcome__orbs--active')).not.toBeNull();
    expect(host.querySelectorAll('.welcome__orb').length).toBe(6);
  });

  it('withTabs_whenModalClosed_isNotVisible', () => {
    tabs.open('terminal');
    fixture.detectChanges();

    expect(host.querySelector('.modal--visible')).toBeNull();
  });

  it('withTabs_whenModalOpen_isVisibleButNotAmbient', () => {
    tabs.open('terminal');
    modal.open();
    fixture.detectChanges();

    expect(host.querySelector('.modal--visible')).not.toBeNull();
    expect(host.querySelector('.welcome-modal--ambient')).toBeNull();
  });
});
