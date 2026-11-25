import {
  Component,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  Injector,
  input,
  InputSignal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  POPOUT_DOCK_CONFIG,
  PopoutDockHost,
} from '@shared/angular/components/popout-dock-host/popout-dock-host';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import { DOCK_BLUEPRINT, DockBlueprint } from '../../../services/dock-layout/dock-blueprint';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { DockNode, mkSplit, mkStack, StackNode } from '../../../services/dock-layout/dock-node';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { DockState } from '../../../services/dock-layout/dock-state';
import { findStackOfPanel } from '../../../services/dock-layout/dock-tree';
import { DockContainer } from './dock-container';

/**
 * A panel's content.
 */
@Component({ template: '<p class="body">body</p>' })
class TestPanel {
  public readonly panel: InputSignal<DockPanel | undefined> = input<DockPanel | undefined>();
}

/**
 * Builds a dock with one tool group of two tabs beside a main group.
 * @param more How it looks and which buttons it shows.
 * @returns Returns the blueprint.
 */
function blueprint(more: Partial<DockBlueprint> = {}): DockBlueprint {
  return {
    createLayout: (): DockNode =>
      mkSplit('row', [mkStack('main', ['editor']), mkStack('tool', ['agent', 'find'])]),
    panels: [
      { id: 'editor', title: 'Editor', icon: Icon.CODE, role: 'main', component: TestPanel },
      { id: 'agent', title: 'Agent', icon: Icon.AGENT, role: 'tool', component: TestPanel },
      { id: 'find', title: 'Find', icon: Icon.SEARCH, role: 'tool', component: TestPanel },
    ],
    ...more,
  };
}

describe("a dock's appearance and buttons (#1569)", () => {
  let host: HTMLElement;
  let fixture: ComponentFixture<DockContainer>;

  /**
   * Draws a dock.
   * @param own Its blueprint.
   */
  function draw(own: DockBlueprint): void {
    TestBed.configureTestingModule({
      imports: [DockContainer],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: own }],
    });
    TestBed.inject(Settings).set('appearance.workspaceTexture', 'bubbles');
    fixture = TestBed.createComponent(DockContainer);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  /**
   * Reads the names of a title bar's buttons.
   * @param bar The selector of the title bar's buttons.
   * @returns Returns the names, in order.
   */
  function buttons(bar: string = '.dock-tab-group__title-buttons'): readonly string[] {
    return [...host.querySelectorAll(`${bar} app-button`)].map(
      (button: Element): string =>
        button.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '',
    );
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('unsaid_isTheFullLook_withEveryButton', () => {
    draw(blueprint());

    expect(host.getAttribute('data-appearance')).toBe('full');
    expect(host.querySelector<HTMLElement>('.dock-container')?.style.padding).toBe('0.5rem');
    expect(buttons()).toEqual(['Auto Hide', 'Float', 'Open in New Window', 'Close']);
  });

  it('simple_hasNoPaddingOrTexture_andTheSameStructure', () => {
    draw(blueprint({ appearance: 'simple' }));

    expect(host.getAttribute('data-appearance')).toBe('simple');
    expect(host.getAttribute('data-texture')).toBeNull();
    expect(host.querySelector<HTMLElement>('.dock-container')?.style.padding).toBe('0px');
    expect(host.querySelector('.dock-tab-group__title-text')?.textContent).toBe('Agent');
    expect(
      [...host.querySelectorAll('.dock-tab__label')].map((label: Element): string =>
        (label.textContent ?? '').trim(),
      ),
    ).toEqual(['Agent', 'Find']);
  });

  it('simple_showsAGroupsTabs_onlyWhileItShowsMoreThanOnePanel', () => {
    draw(blueprint({ appearance: 'simple', startsOpen: ['agent'] }));
    const dock: DockState = TestBed.inject(DockState);

    expect(host.querySelector('.dock-tab-group__title-text')?.textContent).toBe('Agent');
    expect(host.querySelector('.dock-tab-group__tabstrip')).toBeNull();

    dock.open('find');
    fixture.detectChanges();
    expect(host.querySelectorAll('.dock-tab')).toHaveLength(2);

    dock.release('agent');
    fixture.detectChanges();
    expect(host.querySelector('.dock-tab-group__title-text')?.textContent).toBe('Find');
    expect(host.querySelector('.dock-tab-group__tabstrip')).toBeNull();
  });

  it('full_showsTheTabOfASinglePanelToo', () => {
    draw(blueprint({ startsOpen: ['agent'] }));

    expect(host.querySelectorAll('.dock-tab')).toHaveLength(1);
  });

  it('buttons_whenNamed_areTheOnlyOnesShown', () => {
    draw(blueprint({ buttons: ['close'] }));

    expect(buttons()).toEqual(['Close']);
  });

  it('buttons_leftOut_canStillBeDone', () => {
    draw(blueprint({ buttons: [] }));
    expect(buttons()).toEqual([]);

    TestBed.inject(DockFloating).float('agent', { left: 0, top: 0, width: 200, height: 200 });
    fixture.detectChanges();

    expect(host.querySelector('.dock-float')).not.toBeNull();
  });

  it('aPeek_showsThemToo_andCanAlwaysBeDockedAgain', () => {
    draw(blueprint({ buttons: ['close'] }));
    const stack: StackNode = findStackOfPanel(TestBed.inject(DockState).layout(), 'agent')!;

    TestBed.inject(DockAutoHide).pin(stack.id, 'right');
    TestBed.inject(DockAutoHide).showFlyout(stack.id);
    fixture.detectChanges();

    expect(buttons('.dock-collapsed-strip__flyout-title-buttons')).toEqual(['Dock', 'Close']);
  });

  it('aPopOut_looksAsTheDockItCameFrom', () => {
    draw(blueprint({ appearance: 'simple', buttons: ['close'] }));
    const window: ComponentRef<PopoutDockHost> = createComponent(PopoutDockHost, {
      environmentInjector: TestBed.inject(EnvironmentInjector),
      elementInjector: Injector.create({
        providers: [
          { provide: POPOUT_DOCK_CONFIG, useValue: { document, panelId: 'agent' } },
          { provide: DOCK_BLUEPRINT, useValue: TestBed.inject(DOCK_BLUEPRINT) },
        ],
        parent: TestBed.inject(Injector),
      }),
      hostElement: document.body.appendChild(document.createElement('div')),
    });
    window.changeDetectorRef.detectChanges();
    host = window.location.nativeElement as HTMLElement;

    expect(host.querySelector('app-dock-container')?.getAttribute('data-appearance')).toBe(
      'simple',
    );
    expect(buttons()).toEqual(['Close']);

    window.destroy();
    host.remove();
  });
});
