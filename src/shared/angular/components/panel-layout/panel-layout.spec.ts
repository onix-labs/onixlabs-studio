import { ChangeDetectionStrategy, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Panel } from './panel';
import { PanelLayout } from './panel-layout';

@Component({
  selector: 'app-panel-layout-host',
  imports: [PanelLayout, Panel],
  template: `
    <app-panel-layout>
      <div main class="main-content">MAIN</div>
      <app-panel edge="right" [visible]="visible()" [size]="200">
        <div class="side-content">SIDE</div>
      </app-panel>
    </app-panel-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PanelLayoutHost {
  public readonly visible: WritableSignal<boolean> = signal<boolean>(true);
}

describe('PanelLayout', () => {
  it('render_projectsMainContentAndAnEdgePanelOntoItsEdge', async () => {
    const fixture: ComponentFixture<PanelLayoutHost> = TestBed.createComponent(PanelLayoutHost);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.main-content')?.textContent).toContain('MAIN');
    const panel: HTMLElement | null = host.querySelector('app-panel');
    expect(panel?.getAttribute('data-edge')).toBe('right');
    expect(panel?.style.getPropertyValue('grid-area')).toBe('right');
    expect(host.querySelector('.side-content')?.textContent).toContain('SIDE');
  });

  it('visible_whenToggledOff_addsHiddenClassButKeepsContentMounted', async () => {
    const fixture: ComponentFixture<PanelLayoutHost> = TestBed.createComponent(PanelLayoutHost);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const panel: HTMLElement = host.querySelector<HTMLElement>('app-panel')!;
    expect(panel.classList.contains('panel--hidden')).toBe(false);

    fixture.componentInstance.visible.set(false);
    await fixture.whenStable();

    expect(panel.classList.contains('panel--hidden')).toBe(true);
    // The content is collapsed, not destroyed, so a hosted session would survive.
    expect(host.querySelector('.side-content')).not.toBeNull();
  });
});
