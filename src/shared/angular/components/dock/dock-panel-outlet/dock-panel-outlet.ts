import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  Type,
} from '@angular/core';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';

/**
 * Projects a registered dock panel's component into the tab body, resolving it by identifier from
 * the {@link DockPanelRegistry} and passing the panel through as the component's `panel` input.
 */
@Component({
  selector: 'app-dock-panel-outlet',
  imports: [NgComponentOutlet],
  templateUrl: './dock-panel-outlet.html',
  styleUrl: './dock-panel-outlet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockPanelOutlet {
  /**
   * Holds the registry the panel component is resolved from.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

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
