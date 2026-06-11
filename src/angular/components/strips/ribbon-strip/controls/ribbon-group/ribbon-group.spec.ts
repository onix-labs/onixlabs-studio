import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonGroup } from './ribbon-group';

describe('RibbonGroup', () => {
  let component: RibbonGroup;
  let fixture: ComponentFixture<RibbonGroup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonGroup],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonGroup);
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
