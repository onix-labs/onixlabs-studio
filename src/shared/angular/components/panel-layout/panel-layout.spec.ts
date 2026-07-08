import { ChangeDetectionStrategy, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanelArrangements } from './panel-arrangements';
import { Panel } from './panel';
import { PanelLayout } from './panel-layout';

@Component({
  selector: 'app-panel-layout-host',
  imports: [PanelLayout, Panel],
  template: `
    <app-panel-layout [layoutKey]="layoutKey">
      <div main class="main-content">MAIN</div>
      <app-panel panelId="side" defaultEdge="right" [visible]="visible()" [defaultSize]="200">
        <div class="side-content">SIDE</div>
      </app-panel>
      @if (extraMounted()) {
        <app-panel panelId="extra" defaultEdge="right" [defaultSize]="240">
          <div class="extra-content">EXTRA</div>
        </app-panel>
      }
    </app-panel-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PanelLayoutHost {
  public layoutKey: string | null = null;
  public readonly visible: WritableSignal<boolean> = signal<boolean>(true);
  public readonly extraMounted: WritableSignal<boolean> = signal<boolean>(false);
}

describe('PanelLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function createHost(layoutKey: string | null = null): Promise<{
    fixture: ComponentFixture<PanelLayoutHost>;
    host: HTMLElement;
  }> {
    const fixture: ComponentFixture<PanelLayoutHost> = TestBed.createComponent(PanelLayoutHost);
    fixture.componentInstance.layoutKey = layoutKey;
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  function wrapperOf(host: HTMLElement, edge: string): HTMLElement {
    return host.querySelector<HTMLElement>(`.panel-layout__edge[data-edge='${edge}']`)!;
  }

  it('render_projectsMainContentAndRehomesAPanelIntoItsEdgeWrapper', async () => {
    const { host } = await createHost();

    expect(host.querySelector('.main-content')?.textContent).toContain('MAIN');
    const panel: HTMLElement | null = host.querySelector('app-panel');
    expect(panel?.getAttribute('data-edge')).toBe('right');
    expect(panel?.parentElement).toBe(wrapperOf(host, 'right'));
    expect(host.querySelector('.side-content')?.textContent).toContain('SIDE');
  });

  it('render_stacksSameEdgePanelsInOrderInsideOneWrapper', async () => {
    const { fixture, host } = await createHost();
    fixture.componentInstance.extraMounted.set(true);
    await fixture.whenStable();

    const wrapper: HTMLElement = wrapperOf(host, 'right');
    const panels: HTMLElement[] = Array.from(wrapper.querySelectorAll<HTMLElement>('app-panel'));
    expect(panels.length).toBe(2);
    // Both panels live side by side in the wrapper's flex stack — no overlap.
    expect(panels[0].querySelector('.side-content')).not.toBeNull();
    expect(panels[1].querySelector('.extra-content')).not.toBeNull();
  });

  it('visible_whenToggledOff_addsHiddenClassButKeepsContentMounted', async () => {
    const { fixture, host } = await createHost();
    const panel: HTMLElement = host.querySelector<HTMLElement>('app-panel')!;
    expect(panel.classList.contains('panel--hidden')).toBe(false);

    fixture.componentInstance.visible.set(false);
    await fixture.whenStable();

    expect(panel.classList.contains('panel--hidden')).toBe(true);
    // The content is collapsed, not destroyed, so a hosted session would survive.
    expect(host.querySelector('.side-content')).not.toBeNull();
    // An edge with no visible panel collapses its wrapper.
    expect(wrapperOf(host, 'right').style.width).toBe('0px');
  });

  it('arrangement_whenAPanelMovesEdge_rehomesTheSameElementWithoutRecreatingIt', async () => {
    const { fixture, host } = await createHost('layout-spec');
    const arrangements: PanelArrangements = TestBed.inject(PanelArrangements);
    const panel: HTMLElement = host.querySelector<HTMLElement>('app-panel')!;
    const content: HTMLElement = host.querySelector<HTMLElement>('.side-content')!;

    arrangements.move('layout-spec', 'side', 'bottom');
    await fixture.whenStable();

    // The very same elements moved — the component instance (and any session it hosts) survives.
    expect(panel.parentElement).toBe(wrapperOf(host, 'bottom'));
    expect(host.querySelector('.side-content')).toBe(content);
    expect(panel.getAttribute('data-edge')).toBe('bottom');
  });

  it('layoutKey_whenSet_seedsDefaultsIntoThePersistedArrangement', async () => {
    await createHost('layout-spec');
    const arrangements: PanelArrangements = TestBed.inject(PanelArrangements);

    expect(arrangements.arrangement('layout-spec')()['side']).toEqual({
      edge: 'right',
      order: 0,
      size: 200,
    });
  });

  it('layoutKey_whenAPanelMountsLate_seedsItsBoundDefaultsNotTheClassDefaults', async () => {
    const { fixture } = await createHost('layout-late-spec');
    const arrangements: PanelArrangements = TestBed.inject(PanelArrangements);
    expect(arrangements.arrangement('layout-late-spec')()['extra']).toBeUndefined();

    fixture.componentInstance.extraMounted.set(true);
    await fixture.whenStable();

    // The seed must reflect the [defaultSize]="240" binding, not Panel's class default — a plain
    // effect could observe the just-created panel before its dynamic bindings were applied.
    expect(arrangements.arrangement('layout-late-spec')()['extra']).toEqual({
      edge: 'right',
      order: 1,
      size: 240,
    });
  });

  it('edgeSizes_clampSideColumnsPerPanelAndSumTheEdge', async () => {
    const { fixture, host } = await createHost('layout-clamp-spec');

    // A single column renders at its own stored width (its 200px default, above the panel minimum),
    // and the edge is the sum of its columns.
    expect(wrapperOf(host, 'right').style.width).toBe('200px');

    TestBed.inject(PanelArrangements).resizePanel('layout-clamp-spec', 'side', 5000);
    await fixture.whenStable();

    // Cap: half of jsdom's 1024px viewport wins over the oversized stored width.
    expect(wrapperOf(host, 'right').style.width).toBe('512px');
  });

  it('grip_whileDragged_carriesTheActiveClass', async () => {
    const { fixture, host } = await createHost();
    const grip: HTMLElement = wrapperOf(host, 'right').querySelector<HTMLElement>(
      '.panel-layout__grip',
    )!;

    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    await fixture.whenStable();

    expect(grip.classList.contains('panel-layout__grip--active')).toBe(true);

    document.dispatchEvent(new MouseEvent('mouseup'));
    await fixture.whenStable();
    expect(grip.classList.contains('panel-layout__grip--active')).toBe(false);
  });
});
