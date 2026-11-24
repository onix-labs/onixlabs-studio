import {
  computed,
  Directive,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  Signal,
  TemplateRef,
  untracked,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { StackRole } from '../../../services/dock-layout/dock-node';

/**
 * Declares a dock panel in a view's own template, its content written inline and bound to the view:
 *
 * ```html
 * <ng-template appDockPanel="disasm" panelTitle="Disassembly" [panelIcon]="Icon.CODE">
 *   <app-binary-disasm-panel [document]="document" (closed)="onHideDisasm()" />
 * </ng-template>
 * <app-dock-container />
 * ```
 *
 * The dock draws the content wherever the panel lives — a group, a floating window, a pop-out window —
 * and only while it is shown there, so an unopened panel costs nothing. It is created afresh whenever the
 * panel moves, as every panel's content is, so state that must last belongs to the view.
 *
 * The view's {@link import('../../../services/dock-layout/dock-blueprint').DockBlueprint} names the panel
 * among its `templatePanels`, so a saved layout may hold it. Until it is declared, and again once it goes
 * (an `@if` around it), the dock passes it over and keeps its place.
 */
@Directive({ selector: 'ng-template[appDockPanel]' })
export class DockTemplatePanel implements OnInit, OnDestroy {
  /**
   * Holds the registry the panel is registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the panel's content.
   */
  private readonly template: TemplateRef<void> = inject<TemplateRef<void>>(TemplateRef);

  /**
   * Gets the panel's identifier.
   */
  public readonly appDockPanel: InputSignal<string> = input.required<string>();

  /**
   * Gets the panel's title.
   */
  public readonly panelTitle: InputSignal<string> = input.required<string>();

  /**
   * Gets the panel's icon.
   */
  public readonly panelIcon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Gets the role the panel docks as.
   */
  public readonly panelRole: InputSignal<StackRole> = input<StackRole>('tool');

  /**
   * Gets the narrowest width, in rem, the panel still works at; undefined for the usual one.
   */
  public readonly minInlineSize: InputSignal<number | undefined> = input<number | undefined>();

  /**
   * Gets the least height, in rem, the panel's content still works at; undefined for the usual one.
   */
  public readonly minBlockSize: InputSignal<number | undefined> = input<number | undefined>();

  /**
   * Gets the size, in pixels, the panel prefers its group to open at beside a main group; undefined for a
   * share of the room.
   */
  public readonly defaultSize: InputSignal<number | undefined> = input<number | undefined>();

  /**
   * Gets the greatest size, in pixels, the panel's group may be dragged to; undefined for no limit.
   */
  public readonly maxSize: InputSignal<number | undefined> = input<number | undefined>();

  /**
   * Gets the panel as the dock knows it.
   */
  private readonly panel: Signal<DockPanel> = computed((): DockPanel => {
    const minInlineSize: number | undefined = this.minInlineSize();
    const minBlockSize: number | undefined = this.minBlockSize();
    const defaultSize: number | undefined = this.defaultSize();
    const maxSize: number | undefined = this.maxSize();
    return {
      id: this.appDockPanel(),
      title: this.panelTitle(),
      icon: this.panelIcon(),
      role: this.panelRole(),
      template: this.template,
      ...(minInlineSize === undefined ? {} : { minInlineSize }),
      ...(minBlockSize === undefined ? {} : { minBlockSize }),
      ...(defaultSize === undefined ? {} : { defaultSize }),
      ...(maxSize === undefined ? {} : { maxSize }),
    };
  });

  /**
   * Holds the panel as last registered, or null before it has been.
   */
  private registered: DockPanel | null = null;

  public constructor() {
    effect((): void => {
      const panel: DockPanel = this.panel();
      untracked((): void => this.register(panel));
    });
  }

  /**
   * Registers the panel before the dock below it is first drawn.
   */
  public ngOnInit(): void {
    this.register(this.panel());
  }

  /**
   * Withdraws the panel.
   */
  public ngOnDestroy(): void {
    this.withdraw();
  }

  /**
   * Registers the panel in place of what was registered before.
   * @param panel The panel.
   */
  private register(panel: DockPanel): void {
    if (this.registered === panel) {
      return;
    }
    if (this.registered !== null && this.registered.id !== panel.id) {
      this.withdraw();
    }
    this.registered = panel;
    this.registry.register(panel);
  }

  /**
   * Removes the panel from the registry, unless another has since taken its identifier.
   */
  private withdraw(): void {
    if (this.registered !== null) {
      this.registry.unregister(this.registered);
      this.registered = null;
    }
  }
}
