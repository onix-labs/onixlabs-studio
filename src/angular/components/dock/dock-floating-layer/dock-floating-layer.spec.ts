import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCK_BLUEPRINT } from '../../../services/dock/dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from '../../../services/dock/dock-test-blueprint';
import { DockFloating } from '../../../services/dock/dock-floating';
import { DockFloatingLayer } from './dock-floating-layer';

describe('DockFloatingLayer', () => {
  let component: DockFloatingLayer;
  let fixture: ComponentFixture<DockFloatingLayer>;
  let floating: DockFloating;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockFloatingLayer],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: TEST_DOCK_BLUEPRINT }],
    }).compileComponents();

    fixture = TestBed.createComponent(DockFloatingLayer);
    component = fixture.componentInstance;
    floating = TestBed.inject(DockFloating);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('render_whenNoFloats_showsNothing', () => {
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.dock-float')).toBeNull();
  });

  it('render_whenAPanelIsFloating_showsAWindowWithItsTitle', () => {
    floating.float('output', { left: 50, top: 60, width: 320, height: 220 });
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const window: HTMLElement | null = element.querySelector<HTMLElement>('.dock-float');
    expect(window).not.toBeNull();
    expect(window?.textContent).toContain('Output');
  });
});
