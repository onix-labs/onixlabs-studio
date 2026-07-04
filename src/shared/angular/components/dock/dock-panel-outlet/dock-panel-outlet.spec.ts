import { Component, input, InputSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DOCK_BLUEPRINT, DockBlueprint } from '../../../services/dock/dock-blueprint';
import { DockNode, mkStack } from '../../../services/dock/dock-node';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelOutlet } from './dock-panel-outlet';

/**
 * A stub panel body carrying a recognisable marker, so the outlet's projection can be asserted
 * without depending on any feature panel. It declares the `panel` input the outlet binds.
 */
@Component({ selector: 'app-stub-panel', template: '<div class="stub-body">stub</div>' })
class StubPanel {
  public readonly panel: InputSignal<DockPanel | undefined> = input<DockPanel>();
}

/**
 * A blueprint cataloguing the stub panel, standing in for a real tab's.
 */
const BLUEPRINT: DockBlueprint = {
  key: 'test',
  createLayout: (): DockNode => mkStack('tool', ['stub']),
  panels: [{ id: 'stub', title: 'Stub', icon: Icon.CODE, role: 'tool', component: StubPanel }],
};

describe('DockPanelOutlet', () => {
  let component: DockPanelOutlet;
  let fixture: ComponentFixture<DockPanelOutlet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DockPanelOutlet],
      providers: [{ provide: DOCK_BLUEPRINT, useValue: BLUEPRINT }],
    }).compileComponents();

    fixture = TestBed.createComponent(DockPanelOutlet);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('panelId', 'stub');
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('render_whenPanelRegistered_projectsItsComponent', () => {
    fixture.componentRef.setInput('panelId', 'stub');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.stub-body')).not.toBeNull();
  });

  it('render_whenPanelUnknown_showsTheMissingMessage', () => {
    fixture.componentRef.setInput('panelId', 'absent');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Unknown panel: absent');
  });
});
