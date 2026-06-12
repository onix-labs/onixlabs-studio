import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tab } from '../../../../services/tabs/tab';
import { Icon } from '../../../../icons/icon';
import { TitleStripTab } from './title-strip-tab';

describe('TitleStripTab', () => {
  let component: TitleStripTab;
  let fixture: ComponentFixture<TitleStripTab>;

  const sampleTab: Tab = { id: 'tab-1', type: 'code', title: 'Code', icon: Icon.CODE };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TitleStripTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleStripTab);
    fixture.componentRef.setInput('tab', sampleTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenGivenATab_showsItsTitle', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('span')?.textContent).toContain('Code');
  });

  it('selectTab_whenTabPressed_emits', () => {
    let selected: boolean = false;
    component.selectTab.subscribe((): void => {
      selected = true;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element
      .querySelector<HTMLElement>('[role="tab"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(selected).toBe(true);
  });

  it('closeTab_whenCloseButtonClicked_emits', () => {
    let closed: boolean = false;
    component.closeTab.subscribe((): void => {
      closed = true;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('button')?.click();

    expect(closed).toBe(true);
  });
});
