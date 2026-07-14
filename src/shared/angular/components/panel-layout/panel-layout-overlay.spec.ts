import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { PanelLayoutDrag } from './panel-layout-drag';
import { PanelLayoutOverlay } from './panel-layout-overlay';
import { PanelEdge, PanelRect } from './panel-types';

describe('PanelLayoutOverlay', () => {
  let component: PanelLayoutOverlay;
  let fixture: ComponentFixture<PanelLayoutOverlay>;
  let host: HTMLElement;
  let active: WritableSignal<boolean>;
  let title: WritableSignal<string>;
  let ghost: WritableSignal<PanelRect | null>;
  let preview: WritableSignal<PanelRect | null>;
  let hotEdge: WritableSignal<PanelEdge | null>;
  let workspace: WritableSignal<PanelRect | null>;
  let allowedEdges: WritableSignal<readonly PanelEdge[]>;

  beforeEach(async () => {
    active = signal<boolean>(false);
    title = signal<string>('');
    ghost = signal<PanelRect | null>(null);
    preview = signal<PanelRect | null>(null);
    hotEdge = signal<PanelEdge | null>(null);
    workspace = signal<PanelRect | null>(null);
    allowedEdges = signal<readonly PanelEdge[]>(['left', 'right', 'top', 'bottom']);
    const dragStub: Partial<PanelLayoutDrag> = {
      active,
      title,
      ghost,
      preview,
      hotEdge,
      workspace,
      allowedEdges,
    };

    await TestBed.configureTestingModule({
      imports: [PanelLayoutOverlay],
      providers: [{ provide: PanelLayoutDrag, useValue: dragStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(PanelLayoutOverlay);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  it('render_whenIdle_showsNothing', () => {
    fixture.detectChanges();

    expect(host.querySelector('.panel-layout-overlay')).toBeNull();
  });

  it('render_whenDragging_showsTheGhostWithItsTitleAndPosition', () => {
    active.set(true);
    title.set('Terminal');
    ghost.set({ left: 20, top: 30, width: 200, height: 100 });
    fixture.detectChanges();

    const element: HTMLElement | null = host.querySelector<HTMLElement>(
      '.panel-layout-overlay__ghost',
    );
    expect(element).not.toBeNull();
    expect(element?.style.left).toBe('20px');
    expect(element?.style.top).toBe('30px');
    expect(element?.textContent).toContain('Terminal');
  });

  it('render_whenTheWorkspaceIsMeasured_rendersFourEdgeGuidesAndMarksTheHotOne', () => {
    active.set(true);
    workspace.set({ left: 0, top: 0, width: 800, height: 600 });
    hotEdge.set('left');
    fixture.detectChanges();

    expect(host.querySelectorAll('.panel-layout-overlay__edge').length).toBe(4);
    expect(host.querySelectorAll('.panel-layout-overlay__edge--hot').length).toBe(1);
  });

  it('render_whenEdgesRestricted_drawsOnlyTheAllowedGuides', () => {
    active.set(true);
    workspace.set({ left: 0, top: 0, width: 800, height: 600 });
    allowedEdges.set(['left', 'right']);
    fixture.detectChanges();

    // Only the two side guides render; the hidden top and bottom guides are absent.
    expect(host.querySelectorAll('.panel-layout-overlay__edge').length).toBe(2);
  });

  it('render_whenAnEdgeIsTargeted_showsTheDropPreviewSlab', () => {
    active.set(true);
    preview.set({ left: 0, top: 0, width: 400, height: 600 });
    fixture.detectChanges();

    const slab: HTMLElement | null = host.querySelector<HTMLElement>(
      '.panel-layout-overlay__preview',
    );
    expect(slab).not.toBeNull();
    expect(slab?.style.width).toBe('400px');
    expect(slab?.style.height).toBe('600px');
  });

  it('guideIconAndRotation_orientEachEdgeGuide', () => {
    const exposed: {
      guideIcon(edge: PanelEdge): Icon;
      guideRotation(edge: PanelEdge): number;
    } = component as unknown as {
      guideIcon(edge: PanelEdge): Icon;
      guideRotation(edge: PanelEdge): number;
    };

    expect(exposed.guideIcon('left')).toBe(Icon.COLLAPSE_HORIZONTAL);
    expect(exposed.guideIcon('right')).toBe(Icon.COLLAPSE_HORIZONTAL);
    expect(exposed.guideIcon('top')).toBe(Icon.COLLAPSE_VERTICAL);
    expect(exposed.guideIcon('bottom')).toBe(Icon.COLLAPSE_VERTICAL);
    expect(exposed.guideRotation('left')).toBe(180);
    expect(exposed.guideRotation('top')).toBe(180);
    expect(exposed.guideRotation('right')).toBe(0);
    expect(exposed.guideRotation('bottom')).toBe(0);
  });
});
