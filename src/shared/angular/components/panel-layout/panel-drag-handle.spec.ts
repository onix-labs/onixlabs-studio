import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Panel } from './panel';
import { PanelDragHandle } from './panel-drag-handle';
import { PanelLayout } from './panel-layout';
import { PanelLayoutDrag } from './panel-layout-drag';

@Component({
  selector: 'app-panel-drag-handle-host',
  imports: [PanelLayout, Panel, PanelDragHandle],
  template: `
    <app-panel-layout>
      <div main>MAIN</div>
      <app-panel panelId="agent" defaultEdge="right">
        <div class="header" appPanelDragHandle="Agent">
          <span class="title">Agent</span>
          <button type="button" class="close">×</button>
        </div>
      </app-panel>
    </app-panel-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PanelDragHandleHost {}

@Component({
  selector: 'app-panel-drag-handle-orphan',
  imports: [PanelDragHandle],
  template: `<div class="header" appPanelDragHandle="Orphan">Orphan</div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PanelDragHandleOrphan {}

describe('PanelDragHandle', () => {
  function mouseDown(element: HTMLElement): void {
    element.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }),
    );
  }

  async function createHost(): Promise<{
    fixture: ComponentFixture<PanelDragHandleHost>;
    drag: PanelLayoutDrag;
  }> {
    const fixture: ComponentFixture<PanelDragHandleHost> =
      TestBed.createComponent(PanelDragHandleHost);
    await fixture.whenStable();
    const drag: PanelLayoutDrag = fixture.debugElement
      .query(By.directive(PanelLayout))
      .injector.get(PanelLayoutDrag);
    return { fixture, drag };
  }

  it('mousedown_onTheHandleSurface_armsAPanelDrag', async () => {
    const { fixture, drag } = await createHost();
    const header: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector('.header')!;

    mouseDown(header);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(drag.active()).toBe(true);
    expect(drag.panelId()).toBe('agent');
    expect(drag.title()).toBe('Agent');

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('mousedown_onAButtonInsideTheHandle_neverArmsADrag', async () => {
    const { fixture, drag } = await createHost();
    const button: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector('.close')!;

    mouseDown(button);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('mousedown_withASecondaryButton_neverArmsADrag', async () => {
    const { fixture, drag } = await createHost();
    const header: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector('.header')!;

    header.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true, button: 2 }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('mousedown_outsideAPanelLayout_isInert', async () => {
    const fixture: ComponentFixture<PanelDragHandleOrphan> =
      TestBed.createComponent(PanelDragHandleOrphan);
    await fixture.whenStable();
    const header: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector('.header')!;

    // The directive resolves no panel and no drag coordinator, so the press is a no-op.
    expect((): void => mouseDown(header)).not.toThrow();
  });
});
