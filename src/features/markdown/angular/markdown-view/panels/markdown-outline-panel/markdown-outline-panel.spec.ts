import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownCommands } from '@shared/angular/services/markdown-commands/markdown-commands';
import { MarkdownOutlinePanel } from './markdown-outline-panel';

describe('MarkdownOutlinePanel', () => {
  let component: MarkdownOutlinePanel;
  let fixture: ComponentFixture<MarkdownOutlinePanel>;
  let commands: MarkdownCommands;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownOutlinePanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownOutlinePanel);
    component = fixture.componentInstance;
    commands = TestBed.inject(MarkdownCommands);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledOutline', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Outline');
  });

  it('render_whenNoHeadings_showsEmptyState', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.outline__empty')).not.toBeNull();
    expect(element.querySelector('.outline__item')).toBeNull();
  });

  it('render_whenHeadings_listsThemInDocumentOrder', () => {
    commands.setOutline([
      { id: 'heading-0', level: 1, text: 'Title', index: 0 },
      { id: 'heading-1', level: 2, text: 'Section', index: 1 },
    ]);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const items: HTMLButtonElement[] = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.outline__item'),
    );
    expect(items.length).toBe(2);
    expect(items[0].textContent?.trim()).toBe('Title');
    expect(items[1].textContent?.trim()).toBe('Section');
  });

  it('render_whenHeadings_drawsTheSteppedConnectorAndMarker', () => {
    commands.setOutline([
      { id: 'heading-0', level: 1, text: 'Title', index: 0 },
      { id: 'heading-1', level: 2, text: 'Section', index: 1 },
    ]);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const path: SVGPathElement | null = element.querySelector<SVGPathElement>(
      '.outline__connector-path',
    );
    expect(path?.getAttribute('d')?.length ?? 0).toBeGreaterThan(0);
    expect(element.querySelector('.outline__marker')).not.toBeNull();
  });

  it('render_whenActiveHeadingSet_marksAndPositionsTheActiveRow', () => {
    commands.setOutline([
      { id: 'heading-0', level: 1, text: 'Title', index: 0 },
      { id: 'heading-1', level: 2, text: 'Section', index: 1 },
    ]);
    commands.setActiveHeading(1);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const items: HTMLButtonElement[] = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.outline__item'),
    );
    expect(items[0].classList.contains('outline__item--active')).toBe(false);
    expect(items[1].classList.contains('outline__item--active')).toBe(true);

    // The marker drops to the second row (index 1): top = 1 * 34 + 7 = 41px.
    const marker: HTMLElement | null = element.querySelector<HTMLElement>('.outline__marker');
    expect(marker?.style.top).toBe('41px');
  });
});
