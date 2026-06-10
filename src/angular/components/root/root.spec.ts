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

  it('render_whenInitialised_showsTheFourLayoutStrips', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

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
