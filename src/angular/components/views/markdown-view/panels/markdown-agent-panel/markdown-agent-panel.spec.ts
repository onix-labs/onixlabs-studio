import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownAgentPanel } from './markdown-agent-panel';

describe('MarkdownAgentPanel', () => {
  let component: MarkdownAgentPanel;
  let fixture: ComponentFixture<MarkdownAgentPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownAgentPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownAgentPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_isTitledAgent', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.tool-panel__title')?.textContent).toContain('Agent');
  });
});
