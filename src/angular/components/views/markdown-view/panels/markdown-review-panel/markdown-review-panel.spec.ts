import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownReviewPanel } from './markdown-review-panel';

describe('MarkdownReviewPanel', () => {
  let component: MarkdownReviewPanel;
  let fixture: ComponentFixture<MarkdownReviewPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownReviewPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownReviewPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledReview', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Review');
  });

  it('render_whenNoActiveEditor_promptsToOpenADocument', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.rv-empty')?.textContent).toContain('Open a markdown document');
    expect(element.querySelector('.rv-chips')).toBeNull();
  });
});
