import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Icon } from '@shared/angular/icons/icon';
import { Accordion } from './accordion';

describe('Accordion', () => {
  let component: Accordion;
  let fixture: ComponentFixture<Accordion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Accordion],
    }).compileComponents();

    fixture = TestBed.createComponent(Accordion);
    fixture.componentRef.setInput('heading', 'TypeScript');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('expanded_whenHeaderClicked_togglesOpen', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.accordion__header')?.click();

    expect(component.expanded()).toBe(true);
  });

  it('render_whenCollapsed_hidesTheBody', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.accordion__body')).toBeNull();
  });

  it('render_whenNoIcon_omitsTheLeadingIcon', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.accordion__icon')).toBeNull();
    expect(element.querySelector('.accordion__caret')).not.toBeNull();
  });

  it('render_whenIconGiven_showsItAheadOfTheHeading', async () => {
    fixture.componentRef.setInput('icon', Icon.SUCCESS_FILL);
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const header: HTMLElement | null = element.querySelector('.accordion__header');
    expect(header?.firstElementChild?.classList.contains('accordion__icon')).toBe(true);
    expect(header?.lastElementChild?.classList.contains('accordion__caret')).toBe(true);
  });
});
