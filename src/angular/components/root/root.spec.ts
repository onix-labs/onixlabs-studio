import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tabs } from '../../services/tabs/tabs';
import { Root } from './root';

describe('Root', () => {
  let component: Root;
  let fixture: ComponentFixture<Root>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Root],
    }).compileComponents();

    fixture = TestBed.createComponent(Root);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenNoTabsOpen_showsTheWelcomeScreenInsteadOfTheStrips', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    // The welcome screen stays mounted; it shows by taking the visible state.
    expect(element.querySelector('.welcome--visible')).not.toBeNull();
    expect(element.querySelector('.title-strip')).toBeNull();
    expect(element.querySelector('.status-strip')).toBeNull();
  });

  it('render_whenATabIsOpen_showsTheFourLayoutStrips', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('terminal');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    // Mounted but not visible (no cold-start, no modal summoned).
    expect(element.querySelector('.welcome--visible')).toBeNull();
    expect(element.querySelector('.title-strip')).not.toBeNull();
    expect(element.querySelector('.ribbon-strip')).not.toBeNull();
    expect(element.querySelector('.content')).not.toBeNull();
    expect(element.querySelector('.status-strip')).not.toBeNull();
  });

  it('render_whenSettingsTabActive_hidesTheRibbonStrip', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('settings');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.ribbon-strip')).toBeNull();
  });
});
