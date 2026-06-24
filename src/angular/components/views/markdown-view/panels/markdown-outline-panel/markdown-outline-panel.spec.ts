import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownCommands } from '../../../../../services/markdown-commands/markdown-commands';
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
      { id: 'heading-2', level: 1, text: 'Title', pos: 2 },
      { id: 'heading-9', level: 2, text: 'Section', pos: 9 },
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
});
