import { ComponentFixture, TestBed } from '@angular/core/testing';

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
});
