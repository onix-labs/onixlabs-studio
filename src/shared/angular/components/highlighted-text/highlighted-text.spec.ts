import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HighlightedText } from './highlighted-text';

describe('HighlightedText', () => {
  let component: HighlightedText;
  let fixture: ComponentFixture<HighlightedText>;
  let host: HTMLElement;

  /**
   * Renders the component with the given label and query.
   * @param text The label to render.
   * @param query The query whose matches are highlighted.
   */
  function render(text: string, query: string): void {
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('query', query);
    fixture.detectChanges();
  }

  /**
   * Reads the highlighted runs, in order.
   * @returns Returns the text of each rendered mark.
   */
  function marks(): readonly string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('mark')).map(
      (mark: HTMLElement): string => mark.textContent ?? '',
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HighlightedText],
    }).compileComponents();

    fixture = TestBed.createComponent(HighlightedText);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('should create', () => {
    render('ReadMe.md', '');
    expect(component).toBeTruthy();
  });

  it('render_whenQueryEmpty_rendersThePlainTextUnhighlighted', () => {
    render('ReadMe.md', '');

    expect(marks()).toEqual([]);
    expect(host.textContent).toContain('ReadMe.md');
  });

  it('render_whenQueryWhitespaceOnly_treatsItAsEmpty', () => {
    render('ReadMe.md', '   ');

    expect(marks()).toEqual([]);
  });

  it('render_whenQueryMatches_highlightsCaseInsensitivelyPreservingCase', () => {
    render('ReadMe.md', 'me');

    expect(marks()).toEqual(['Me']);
    expect(host.textContent?.replace(/\s/g, '')).toBe('ReadMe.md');
  });

  it('render_whenMultipleOccurrences_marksEachRun', () => {
    render('banana', 'an');

    expect(marks()).toEqual(['an', 'an']);
    expect(host.textContent?.replace(/\s/g, '')).toBe('banana');
  });

  it('render_whenTheWholeTextMatches_rendersASingleMark', () => {
    render('main', 'MAIN');

    expect(marks()).toEqual(['main']);
  });
});
