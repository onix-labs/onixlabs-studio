import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownReaderPanel } from './markdown-reader-panel';

describe('MarkdownReaderPanel', () => {
  let component: MarkdownReaderPanel;
  let fixture: ComponentFixture<MarkdownReaderPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownReaderPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownReaderPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledReader', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Reader');
  });
});
