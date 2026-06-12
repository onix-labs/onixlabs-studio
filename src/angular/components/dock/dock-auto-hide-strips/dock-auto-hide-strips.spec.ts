import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { StackNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { findStackOfPanel } from '../../../services/dock/dock-tree';
import { DockAutoHideStrips } from './dock-auto-hide-strips';

describe('DockAutoHideStrips', () => {
  let component: DockAutoHideStrips;
  let fixture: ComponentFixture<DockAutoHideStrips>;
  let autoHide: DockAutoHide;
  let state: DockState;

  /**
   * Auto-hides the stack holding the given panel.
   * @param panelId The panel whose stack to pin.
   */
  function pin(panelId: string): void {
    const stack: StackNode | null = findStackOfPanel(state.layout(), panelId);
    autoHide.pin(stack!.id);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockAutoHideStrips],
    }).compileComponents();

    fixture = TestBed.createComponent(DockAutoHideStrips);
    component = fixture.componentInstance;
    autoHide = TestBed.inject(DockAutoHide);
    state = TestBed.inject(DockState);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_whenAStackIsShelved_showsAStripButton', () => {
    pin('solution');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const button: HTMLButtonElement | null =
      element.querySelector<HTMLButtonElement>('.dock-ah-strip__button');
    expect(button?.textContent).toContain('Solution Explorer');
  });

  it('render_whenStripButtonClicked_fliesTheStackOut', () => {
    pin('output');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.dock-ah-strip__button')?.click();
    fixture.detectChanges();

    expect(element.querySelector('.dock-ah-flyout')).not.toBeNull();
  });
});
