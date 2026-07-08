import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockState } from '../../../services/dock-layout/dock-state';
import { findStackOfPanel } from '../../../services/dock-layout/dock-tree';
import { DockContainer } from './dock-container';

describe('DockContainer', () => {
  let component: DockContainer;
  let fixture: ComponentFixture<DockContainer>;
  let dockState: DockState;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockContainer],
    }).compileComponents();

    fixture = TestBed.createComponent(DockContainer);
    component = fixture.componentInstance;
    dockState = TestBed.inject(DockState);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenSeeded_rendersTheRootNode', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-dock-node')).not.toBeNull();
    expect(element.querySelectorAll('app-dock-tab-group').length).toBeGreaterThan(0);
  });

  it('reset_whenCalledAfterAChange_restoresTheSeededLayout', () => {
    dockState.removeFromLayout('output');
    expect(findStackOfPanel(dockState.layout(), 'output')).toBeNull();

    component.reset();

    expect(findStackOfPanel(dockState.layout(), 'output')).not.toBeNull();
  });
});
