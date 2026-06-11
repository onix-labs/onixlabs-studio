import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockFloating } from '../../../services/dock/dock-floating';
import { mkStack, StackNode } from '../../../services/dock/dock-node';
import { DockTabGroup } from './dock-tab-group';

describe('DockTabGroup', () => {
  let component: DockTabGroup;
  let fixture: ComponentFixture<DockTabGroup>;
  let floating: DockFloating;
  let drag: DockDrag;

  /**
   * Renders the group for the given stack, registering it with the state so mutations resolve.
   * @param stack The stack to render.
   */
  function render(stack: StackNode): void {
    fixture.componentRef.setInput('stack', stack);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockTabGroup],
    }).compileComponents();

    fixture = TestBed.createComponent(DockTabGroup);
    component = fixture.componentInstance;
    floating = TestBed.inject(DockFloating);
    drag = TestBed.inject(DockDrag);
  });

  it('should create', () => {
    render(mkStack('tool', ['output']));
    expect(component).toBeTruthy();
  });

  it('render_whenToolRole_showsATitleBar', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__title')).not.toBeNull();
  });

  it('render_whenDocumentRole_omitsTheTitleBar', () => {
    render(mkStack('document', ['doc1']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__title')).toBeNull();
  });

  it('render_whenEmptyStack_showsTheDropHint', () => {
    render(mkStack('document', []));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-tab-group__empty')).not.toBeNull();
  });

  it('requestFloat_whenFloatButtonClicked_floatsTheActivePanel', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const floatButton: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>(
      'button[aria-label="Float"]',
    );
    floatButton?.click();

    expect(floating.floats().some((window): boolean => window.panelId === 'output')).toBe(true);
  });

  it('startDrag_whenTitleBarPressedAndDragged_startsACompassDragForTheActivePanel', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const title: HTMLElement | null = element.querySelector<HTMLElement>('.dock-tab-group__title');
    title?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }));

    expect(drag.panel()?.id).toBe('output');

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('render_whenStackHasAnActivePanel_marksTheActiveTab', () => {
    render(mkStack('tool', ['output', 'errors']));

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const tabs: NodeListOf<HTMLElement> = element.querySelectorAll<HTMLElement>('.dock-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].classList.contains('dock-tab--active')).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });
});
