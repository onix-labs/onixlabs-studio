import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  InputSignal,
  Signal,
  TemplateRef,
  Type,
} from '@angular/core';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { DOCK_PANEL_HOST } from '../../../services/dock-layout/dock-panel-host';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';

/**
 * Projects a registered dock panel's content into the tab body, resolving it by identifier from the
 * {@link DockPanelRegistry}: a component, with the panel passed through as its `panel` input, or a
 * template a view wrote.
 */
@Component({
  selector: 'app-dock-panel-outlet',
  imports: [NgComponentOutlet, NgTemplateOutlet],
  templateUrl: './dock-panel-outlet.html',
  styleUrl: './dock-panel-outlet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: DOCK_PANEL_HOST, useValue: true }],
})
export class DockPanelOutlet {
  /**
   * Holds the registry the panel component is resolved from.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the injector a template's content resolves through, which a component's does already. A
   * template keeps the injector it was written under, the view's in the main window, so in a pop-out its
   * menus would open in the main window and its drags track that document.
   */
  protected readonly injector: Injector = inject(Injector);

  /**
   * Gets the identifier of the panel to project.
   */
  public readonly panelId: InputSignal<string> = input.required<string>();

  /**
   * Gets the resolved panel, or undefined when the identifier is not registered.
   */
  protected readonly panel: Signal<DockPanel | undefined> = computed((): DockPanel | undefined =>
    this.registry.get(this.panelId()),
  );

  /**
   * Gets the template to draw, or null when the panel is not one written in a template.
   */
  protected readonly template: Signal<TemplateRef<void> | null> = computed(
    (): TemplateRef<void> | null => this.panel()?.template ?? null,
  );

  /**
   * Gets the component to project, or null when the panel is not registered.
   */
  protected readonly component: Signal<Type<unknown> | null> = computed(
    (): Type<unknown> | null => this.panel()?.component ?? null,
  );

  /**
   * Gets the inputs bound to the projected component.
   */
  protected readonly inputs: Signal<Record<string, unknown>> = computed(
    (): Record<string, unknown> => {
      const panel: DockPanel | undefined = this.panel();
      return panel !== undefined ? { panel } : {};
    },
  );
}
