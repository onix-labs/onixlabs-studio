import { Component, inject, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelPlaceholder } from '../../components/dock-layout/dock-panel-placeholder/dock-panel-placeholder';
import { DockBlueprint } from './dock-blueprint';
import { DockNode, mkSplit, mkStack } from './dock-node';
import { dockProviders } from './dock-providers';
import { DockReveal } from './dock-reveal';
import { DockState } from './dock-state';
import { linkDockPanel } from './link-dock-panel';

const BLUEPRINT: DockBlueprint = {
  createLayout: (): DockNode =>
    mkSplit('row', [mkStack('main', ['editor']), mkStack('tool', ['find'])]),
  panels: [
    {
      id: 'editor',
      title: 'Editor',
      icon: Icon.CODE,
      role: 'main',
      component: DockPanelPlaceholder,
    },
    { id: 'find', title: 'Find', icon: Icon.SEARCH, role: 'tool', component: DockPanelPlaceholder },
  ],
  startsOpen: [],
};

/**
 * A view whose own state says whether Find is open.
 */
@Component({ template: '', providers: [...dockProviders(BLUEPRINT)] })
class TestView {
  public readonly finding: WritableSignal<boolean> = signal<boolean>(false);
  public readonly told: boolean[] = [];
  public readonly reveal: DockReveal = inject(DockReveal);
  public readonly dock: DockState = inject(DockState);

  public constructor() {
    linkDockPanel(
      'find',
      (): boolean => this.finding(),
      (open: boolean): void => {
        this.told.push(open);
        this.finding.set(open);
      },
    );
  }
}

describe('linkDockPanel', () => {
  let view: TestView;

  beforeEach(() => {
    const fixture: ComponentFixture<TestView> = TestBed.createComponent(TestView);
    view = fixture.componentInstance;
    TestBed.tick();
  });

  it('opensAndClosesThePanel_asWhatItIsTiedToChanges', () => {
    view.finding.set(true);
    TestBed.tick();
    expect(view.reveal.isOpen('find')).toBe(true);

    view.finding.set(false);
    TestBed.tick();
    expect(view.reveal.isOpen('find')).toBe(false);
    expect(view.told).toEqual([]);
  });

  it('tellsWhatItIsTiedTo_whenThePanelIsClosedOrOpenedInTheDock', async () => {
    view.finding.set(true);
    TestBed.tick();

    await view.dock.requestClose('find');
    TestBed.tick();
    expect(view.finding()).toBe(false);

    view.reveal.open('find');
    TestBed.tick();
    expect(view.finding()).toBe(true);
    expect(view.told).toEqual([false, true]);
  });

  it('saysNothing_whenThePanelIsMoved', () => {
    view.finding.set(true);
    TestBed.tick();

    view.dock.removeFromLayout('find');
    view.dock.dockEdge('find', 'left');
    TestBed.tick();

    expect(view.reveal.isOpen('find')).toBe(true);
    expect(view.told).toEqual([]);
  });
});
