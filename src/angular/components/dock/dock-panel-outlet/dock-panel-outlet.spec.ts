import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanelOutlet } from './dock-panel-outlet';

describe('DockPanelOutlet', () => {
  let component: DockPanelOutlet;
  let fixture: ComponentFixture<DockPanelOutlet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockPanelOutlet],
    }).compileComponents();

    fixture = TestBed.createComponent(DockPanelOutlet);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('panelId', 'solution');
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('render_whenPanelRegistered_projectsItsComponent', () => {
    fixture.componentRef.setInput('panelId', 'solution');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Solution Explorer');
  });

  it('render_whenPanelUnknown_showsTheMissingMessage', () => {
    fixture.componentRef.setInput('panelId', 'absent');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Unknown panel: absent');
  });
});
