import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Icon } from '@shared/angular/icons/icon';
import { MarkdownPanels } from '../../../../../services/markdown-panels/markdown-panels';
import { MarkdownToolPanel } from './markdown-tool-panel';

describe('MarkdownToolPanel', () => {
  let component: MarkdownToolPanel;
  let fixture: ComponentFixture<MarkdownToolPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownToolPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownToolPanel);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Outline');
    fixture.componentRef.setInput('icon', Icon.OUTLINE);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_showsTheTitle', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Outline');
  });

  it('close_whenClicked_closesTheActivePanel', () => {
    const panels: MarkdownPanels = TestBed.inject(MarkdownPanels);
    panels.open('outline');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.tool-panel__close')!
      .click();

    expect(panels.active()).toBe('none');
  });
});
