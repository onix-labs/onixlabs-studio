import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockOverlay } from './dock-overlay';

describe('DockOverlay', () => {
  let component: DockOverlay;
  let fixture: ComponentFixture<DockOverlay>;
  let drag: DockDrag;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockOverlay],
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
