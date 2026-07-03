import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { TitleStripTabList } from './title-strip-tab-list';

describe('TitleStripTabList', () => {
  let component: TitleStripTabList;
  let fixture: ComponentFixture<TitleStripTabList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTabList],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripTabList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenTabsOpen_rendersATabPerOpenTab', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    tabs.open('code');
    tabs.open('terminal');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-title-strip-tab').length).toBe(2);
  });

  it('onKeydown_whenArrowRightPressed_activatesTheNextTab', () => {
    const tabs: Tabs = TestBed.inject(Tabs);
    const first: Tab = tabs.open('code');
    const second: Tab = tabs.open('terminal');
    tabs.activate(first.id);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tablist: HTMLElement | null = element.querySelector<HTMLElement>('[role="tablist"]');
    tablist?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(tabs.activeTabId()).toBe(second.id);
  });
});
