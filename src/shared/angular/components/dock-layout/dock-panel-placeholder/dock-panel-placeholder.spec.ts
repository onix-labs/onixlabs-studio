import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelPlaceholder } from './dock-panel-placeholder';

describe('DockPanelPlaceholder', () => {
  let component: DockPanelPlaceholder;
  let fixture: ComponentFixture<DockPanelPlaceholder>;

  const panel: DockPanel = {
    id: 'output',
    title: 'Output',
    icon: Icon.OUTPUT,
    role: 'tool',
    component: DockPanelPlaceholder,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockPanelPlaceholder],
    }).compileComponents();

    fixture = TestBed.createComponent(DockPanelPlaceholder);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenGivenAPanel_showsItsTitle', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Output');
  });
});
