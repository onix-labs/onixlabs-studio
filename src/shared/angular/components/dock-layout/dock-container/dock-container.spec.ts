import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Display } from '@shared/angular/services/display/display';
import { Settings } from '@shared/angular/services/settings/settings';
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

  afterEach(() => {
    // The Display service writes these to the shared document root; specs run without isolation, so
    // leaving them set would follow the suite into the next file.
    document.documentElement.removeAttribute('data-corners');
    document.documentElement.removeAttribute('data-reduced-gpu');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenSeeded_rendersTheRootNode', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-dock-node')).not.toBeNull();
    expect(element.querySelectorAll('app-dock-tab-group').length).toBeGreaterThan(0);
  });

  it('texture_whenNoneIsChosen_leavesTheAttributeOff', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.hasAttribute('data-texture')).toBe(false);
  });

  it('texture_whenChosen_namesItOnTheHost_soTheCatalogueSuppliesThePattern', () => {
    TestBed.inject(Settings).setWorkspaceTexture('circuit-board');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.getAttribute('data-texture')).toBe('circuit-board');
  });

  it('texture_whenBelowTheFullLevel_suppressesItWithoutClearingTheChoice', () => {
    const settings: Settings = TestBed.inject(Settings);
    settings.setWorkspaceTexture('circuit-board');
    TestBed.inject(Display).setGraphicsAcceleration('limited');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.hasAttribute('data-texture')).toBe(false);
    expect(settings.workspaceTexture()).toBe('circuit-board');
  });

  it('texture_whenTheFullLevelIsRestored_paintsTheChosenTextureAgain', () => {
    const display: Display = TestBed.inject(Display);
    TestBed.inject(Settings).setWorkspaceTexture('circuit-board');
    display.setGraphicsAcceleration('limited');
    fixture.detectChanges();

    display.setGraphicsAcceleration('full');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).getAttribute('data-texture')).toBe(
      'circuit-board',
    );
  });

  it('reset_whenCalledAfterAChange_restoresTheSeededLayout', () => {
    dockState.removeFromLayout('output');
    expect(findStackOfPanel(dockState.layout(), 'output')).toBeNull();

    component.reset();

    expect(findStackOfPanel(dockState.layout(), 'output')).not.toBeNull();
  });
});
