import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from '../../../services/dock-layout/dock-test-blueprint';
import { DockDrag } from '../../../services/dock-layout/dock-drag';
import { DockOverlay } from './dock-overlay';

describe('DockOverlay', () => {
  let component: DockOverlay;
  let fixture: ComponentFixture<DockOverlay>;
  let drag: DockDrag;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockOverlay],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: TEST_DOCK_BLUEPRINT }],
    }).compileComponents();

    fixture = TestBed.createComponent(DockOverlay);
    component = fixture.componentInstance;
    drag = TestBed.inject(DockDrag);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_whenIdle_showsNothing', () => {
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-overlay')).toBeNull();
  });

  it('render_whenDragging_showsTheOverlayAndGhost', () => {
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 160, clientY: 160 }));
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-overlay')).not.toBeNull();
    expect(element.querySelector('.dock-overlay__ghost')).not.toBeNull();

    document.dispatchEvent(new MouseEvent('mouseup'));
  });
});
