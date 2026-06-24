import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownOutlinePanel } from './markdown-outline-panel';

describe('MarkdownOutlinePanel', () => {
  let component: MarkdownOutlinePanel;
  let fixture: ComponentFixture<MarkdownOutlinePanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownOutlinePanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownOutlinePanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledOutline', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Outline');
  });
});
