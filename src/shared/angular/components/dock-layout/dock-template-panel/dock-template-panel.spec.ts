import { DOCUMENT } from '@angular/common';
import {
  Component,
  createComponent,
  ComponentRef,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  inject,
  Injector,
  Service,
  signal,
  WritableSignal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  POPOUT_DOCK_CONFIG,
  PopoutDockHost,
} from '@shared/angular/components/popout-dock-host/popout-dock-host';
import { Icon } from '@shared/angular/icons/icon';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import { DockBlueprint } from '../../../services/dock-layout/dock-blueprint';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { DockNode, mkSplit, mkStack, StackNode } from '../../../services/dock-layout/dock-node';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { dockProviders } from '../../../services/dock-layout/dock-providers';
import { DockState } from '../../../services/dock-layout/dock-state';
import { findStackOfPanel } from '../../../services/dock-layout/dock-tree';
import { DockContainer } from '../dock-container/dock-container';
import { DockPanelPlaceholder } from '../dock-panel-placeholder/dock-panel-placeholder';
import { DockTemplatePanel } from './dock-template-panel';

/**
 * A service the view provides for itself.
 */
@Service()
class ViewNotes {
  public readonly text: WritableSignal<string> = signal<string>('from the view');
}

/**
 * The document each outline has been created with, in order, and how many are alive.
 */
const outlines: { documents: Document[]; alive: number } = { documents: [], alive: 0 };

/**
 * Stands in for a panel's content, reading the view's service and its own window's document.
 */
@Component({ selector: 'app-test-outline', template: '{{ notes.text() }}' })
class TestOutline {
  protected readonly notes: ViewNotes = inject(ViewNotes);

  public constructor() {
    outlines.documents.push(inject(DOCUMENT));
    outlines.alive += 1;
    inject(DestroyRef).onDestroy((): void => {
      outlines.alive -= 1;
    });
  }
}

const BLUEPRINT: DockBlueprint = {
  key: 'test-template',
  createLayout: (): DockNode =>
    mkSplit('row', [
      mkStack('main', ['editor']),
      mkStack('tool', ['outline', 'agent'], false, { active: 'outline' }),
      mkStack('tool', ['find']),
    ]),
  panels: [
    {
      id: 'agent',
      title: 'Agent',
      icon: Icon.AGENT,
      role: 'tool',
      component: DockPanelPlaceholder,
    },
  ],
  templatePanels: ['editor', 'outline', 'find'],
};

/**
 * A view that writes its panels in its own template.
 */
@Component({
  imports: [DockContainer, DockTemplatePanel, TestOutline],
  providers: [ViewNotes, ...dockProviders(BLUEPRINT)],
  template: `
    <ng-template appDockPanel="editor" panelTitle="Editor" [panelIcon]="Icon.CODE" panelRole="main">
      <p class="editor">{{ text() }}</p>
    </ng-template>
    <ng-template appDockPanel="outline" [panelTitle]="title()" [panelIcon]="Icon.LIST_ALL">
      <button class="outline" (click)="clicks.set(clicks() + 1)">{{ text() }}</button>
      <app-test-outline />
    </ng-template>
    @if (finding()) {
      <ng-template appDockPanel="find" panelTitle="Find" [panelIcon]="Icon.SEARCH">
        <p class="find">find</p>
      </ng-template>
    }
    <app-dock-container />
  `,
})
class TestView {
  protected readonly Icon: typeof Icon = Icon;
  public readonly title: WritableSignal<string> = signal<string>('Outline');
  public readonly text: WritableSignal<string> = signal<string>('one');
  public readonly clicks: WritableSignal<number> = signal<number>(0);
  public readonly finding: WritableSignal<boolean> = signal<boolean>(false);
  public readonly injector: Injector = inject(Injector);
  public readonly element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
}

describe('DockTemplatePanel (#1566)', () => {
  let fixture: ComponentFixture<TestView>;
  let host: HTMLElement;
  let dock: DockState;

  /**
   * Reads what is written on the dock's tabs.
   * @returns Returns the labels, in order.
   */
  function tabs(): readonly string[] {
    return [...host.querySelectorAll('.dock-tab__label')].map((label: Element): string =>
      (label.textContent ?? '').trim(),
    );
  }

  beforeEach(async () => {
    localStorage.clear();
    outlines.documents = [];
    outlines.alive = 0;
    await TestBed.configureTestingModule({ imports: [TestView] }).compileComponents();
    fixture = TestBed.createComponent(TestView);
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
    dock = fixture.debugElement.injector.get(DockState);
  });

  afterEach(() => localStorage.clear());

  it('render_drawsItsContentInItsGroup_boundToTheView', async () => {
    const button: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      'app-dock-tab-group .outline',
    )!;
    expect(button.textContent).toBe('one');
    expect(host.querySelector('app-test-outline')?.textContent).toBe('from the view');

    fixture.componentInstance.text.set('two');
    await fixture.whenStable();
    button.click();

    expect(button.textContent).toBe('two');
    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('render_asTheMainGroup_drawsItThere', () => {
    expect(host.querySelector('.dock-container__main .editor')?.textContent).toBe('one');
  });

  it('title_whenItChanges_changesTheTabAndLeavesTheContentAlone', async () => {
    const button: Element | null = host.querySelector('.outline');

    fixture.componentInstance.title.set('Outline (3)');
    await fixture.whenStable();

    expect(tabs()).toContain('Outline (3)');
    expect(host.querySelector('.outline')).toBe(button);
    expect(outlines.documents.length).toBe(1);
  });

  it('anotherTabInFront_destroysItsContent_asItDoesAnyPanels', async () => {
    dock.setActive(findStackOfPanel(dock.layout(), 'agent')!.id, 'agent');
    await fixture.whenStable();

    expect(host.querySelector('.outline')).toBeNull();
    expect(outlines.alive).toBe(0);
  });

  it('moving_splittingAndFloating_drawsItWhereverItIs', async () => {
    const floating: DockFloating = fixture.debugElement.injector.get(DockFloating);

    dock.splitPanelOut('outline', 'bottom');
    await fixture.whenStable();
    expect(host.querySelectorAll('.outline').length).toBe(1);

    floating.float('outline', { left: 0, top: 0, width: 200, height: 200 });
    await fixture.whenStable();
    expect(host.querySelector('app-dock-floating-layer .outline')?.textContent).toBe('one');
    expect(outlines.alive).toBe(1);
  });

  it('collapsing_andPeeking_drawsItInThePeek', async () => {
    const stack: StackNode = findStackOfPanel(dock.layout(), 'outline')!;
    const autoHide: DockAutoHide = fixture.debugElement.injector.get(DockAutoHide);

    autoHide.pin(stack.id, 'right');
    await fixture.whenStable();
    expect(host.querySelector('.outline')).toBeNull();

    autoHide.showFlyout(stack.id);
    await fixture.whenStable();
    expect(host.querySelector('app-dock-collapsed-strip .outline')).not.toBeNull();
  });

  it('undeclared_isPassedOverAndKeepsItsPlace', async () => {
    const before: DockNode = dock.layout();
    expect(tabs()).not.toContain('Find');
    expect(host.querySelectorAll('app-split-divider').length).toBe(1);

    fixture.componentInstance.finding.set(true);
    await fixture.whenStable();
    expect(host.querySelector('.find')).not.toBeNull();
    expect(tabs()).toContain('Find');

    fixture.componentInstance.finding.set(false);
    await fixture.whenStable();
    expect(host.querySelector('.find')).toBeNull();
    expect(tabs()).not.toContain('Find');
    expect(dock.layout()).toBe(before);
  });

  it('aSavedLayout_mayHoldAPanelNotYetDeclared', async () => {
    dock.dockEdge('agent', 'left');
    await fixture.whenStable();
    fixture.destroy();

    const again: ComponentFixture<TestView> = TestBed.createComponent(TestView);
    await again.whenStable();
    const restored: DockState = again.debugElement.injector.get(DockState);

    expect(findStackOfPanel(restored.layout(), 'find')?.panels).toEqual(['find']);
    expect(findStackOfPanel(restored.layout(), 'editor')?.role).toBe('main');
  });

  it('twoViews_haveTheirOwnDocksAndPanels', async () => {
    const other: ComponentFixture<TestView> = TestBed.createComponent(TestView);
    await other.whenStable();
    const registry: DockPanelRegistry = other.debugElement.injector.get(DockPanelRegistry);

    expect(registry).not.toBe(fixture.debugElement.injector.get(DockPanelRegistry));
    fixture.destroy();
    expect(registry.has('outline')).toBe(true);
    expect((other.nativeElement as HTMLElement).querySelector('.outline')).not.toBeNull();
  });

  it('poppedOut_keepsTheViewsServices_andBelongsToItsOwnWindowsDocument', () => {
    const popped: Document = document.implementation.createHTMLDocument('popped');
    const window: ComponentRef<PopoutDockHost> = createComponent(PopoutDockHost, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector: Injector.create({
        providers: [
          { provide: POPOUT_DOCK_CONFIG, useValue: { document: popped, panelId: 'outline' } },
        ],
        parent: fixture.componentInstance.injector,
      }),
      hostElement: document.body.appendChild(document.createElement('div')),
    });
    fixture.componentInstance.text.set('popped');
    window.changeDetectorRef.detectChanges();
    const element: HTMLElement = window.location.nativeElement as HTMLElement;

    expect(element.querySelector('.outline')?.textContent).toBe('popped');
    expect(element.querySelector('app-test-outline')?.textContent).toBe('from the view');
    expect(outlines.documents.at(-1)).toBe(popped);
    expect(outlines.documents[0]).toBe(document);

    window.destroy();
    element.remove();
  });
});
