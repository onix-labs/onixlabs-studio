import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStripGroup } from './ribbon-strip-group';

describe('RibbonStripGroup', () => {
  let component: RibbonStripGroup;
  let fixture: ComponentFixture<RibbonStripGroup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripGroup],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripGroup);
    fixture.componentRef.setInput('title', 'Clipboard');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenTitleSet_displaysTheTitle', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.ribbon-group__title')?.textContent).toContain('Clipboard');
  });
});
