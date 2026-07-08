import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Icon } from '@shared/angular/icons/icon';
import { ToolPanel } from './tool-panel';

describe('ToolPanel', () => {
  let component: ToolPanel;
  let fixture: ComponentFixture<ToolPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolPanel);
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

  it('close_whenClicked_emitsClosed', () => {
    let emitted: boolean = false;
    component.closed.subscribe((): void => {
      emitted = true;
    });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.tool-panel__close')!
      .click();

    expect(emitted).toBe(true);
  });
});
