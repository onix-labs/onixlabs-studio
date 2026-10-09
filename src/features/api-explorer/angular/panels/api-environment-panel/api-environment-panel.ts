import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import {
  PropertyGrid,
  PropertyGridEdit,
  PropertyGridRow,
} from '@shared/angular/components/property-grid/property-grid';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { ApiEnvironment, HttpField } from '@shared/api/api-client-types';
import { ApiPrompts } from '../../api-prompts/api-prompts';
import { ApiWorkspace } from '../../api-workspace/api-workspace';

/**
 * The switcher's value for running without an environment.
 */
const NO_ENVIRONMENT: string = '';

/**
 * Identifies Duplicate on the strip's menu.
 */
const DUPLICATE: string = 'environment.duplicate';

/**
 * Identifies Delete on the strip's menu.
 */
const DELETE: string = 'environment.delete';

/**
 * The variable editor for whichever environment is active — the values every `{{token}}` in a request
 * resolves against. Its tool strip (#882) switches the active environment, adds one, and copies or
 * deletes the active one. The switcher and the explorer tree set the same thing — the workspace's
 * active environment — so the two places to make the choice always agree.
 *
 * The variables are edited in the shared property grid, the same one the request's parameters, headers
 * and form fields use: they are the same shape of thing, and a variable should not feel different to
 * edit than the header it ends up in.
 */
@Component({
  selector: 'app-api-environment-panel',
  imports: [Button, CdkMenuTrigger, Dropdown, Menu, PanelToolbar, PropertyGrid],
  templateUrl: './api-environment-panel.html',
  styleUrl: './api-environment-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiEnvironmentPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the API workspace the environment is read from and written to.
   */
  protected readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the prompts, whose New Environment dialog the strip opens.
   */
  protected readonly prompts: ApiPrompts = inject(ApiPrompts);

  /**
   * Holds the file system, whose confirmation guards Delete.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the variable syntax shown in the hint. A literal in the component rather than in the
   * template, because the template would read it as an interpolation of its own.
   */
  protected readonly variableSyntax: string = '{{name}}';

  /**
   * Gets the switcher's value for running without an environment, for the template.
   */
  protected readonly NO_ENVIRONMENT: string = NO_ENVIRONMENT;

  /**
   * Gets the switcher's choices: no environment, then every environment by name.
   */
  protected readonly environmentOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: NO_ENVIRONMENT, label: 'No Environment' },
      ...this.workspace.environments().map((environment: ApiEnvironment): DropdownOption => ({
        value: environment.id,
        label: environment.name,
      })),
    ],
  );

  /**
   * Gets the strip's menu, whose commands act on the active environment and so are disabled while
   * there is none.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => {
    const none: boolean = this.workspace.activeEnvironment() === null;
    return [
      { id: DUPLICATE, label: 'Duplicate', icon: Icon.COPY, disabled: none },
      { id: 'environment.sep', label: '', separator: true },
      { id: DELETE, label: 'Delete', icon: Icon.TRASH, tone: 'danger', disabled: none },
    ];
  });

  /**
   * Makes an environment the active one, or runs without one.
   * @param id The chosen environment's identifier, or the no-environment value.
   */
  protected activate(id: string): void {
    this.workspace.activateEnvironment(id === NO_ENVIRONMENT ? null : id);
  }

  /**
   * Runs a command chosen from the strip's menu, on the active environment.
   * @param id The chosen item's identifier.
   */
  protected async onMenu(id: string): Promise<void> {
    const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
    if (environment === null) {
      return;
    }
    if (id === DUPLICATE) {
      const copy: ApiEnvironment | null = this.workspace.duplicateEnvironment(environment.id);
      if (copy !== null) {
        this.workspace.activateEnvironment(copy.id);
      }
      return;
    }
    if (id === DELETE) {
      const confirmed: boolean = await this.fileSystem.confirmDestructive({
        title: 'Delete Environment',
        message: `Delete "${environment.name}"?`,
        detail: 'This cannot be undone.',
        confirmLabel: 'Delete',
      });
      if (confirmed) {
        this.workspace.removeEnvironment(environment.id);
      }
    }
  }

  /**
   * Applies an edit to one variable, dropping a row the user has blanked out entirely.
   * @param edit The edit reported by the grid.
   */
  protected updateVariable(edit: PropertyGridEdit): void {
    this.writeVariables((variables: readonly HttpField[]): readonly HttpField[] =>
      variables
        .map((variable: HttpField): HttpField =>
          variable.id === edit.id
            ? {
                ...variable,
                ...(edit.name !== undefined ? { name: edit.name } : {}),
                ...(edit.value !== undefined ? { value: edit.value } : {}),
                ...(edit.enabled !== undefined ? { enabled: edit.enabled } : {}),
              }
            : variable,
        )
        .filter((variable: HttpField): boolean => variable.name !== '' || variable.value !== ''),
    );
  }

  /**
   * Stores a variable the user has started typing into the grid's blank row.
   * @param row The new row, under the identity the grid handed over.
   */
  protected addVariable(row: PropertyGridRow): void {
    this.writeVariables((variables: readonly HttpField[]): readonly HttpField[] => [
      ...variables,
      { id: row.id, name: row.name, value: row.value, enabled: row.enabled !== false },
    ]);
  }

  /**
   * Removes a variable.
   * @param id The row identifier.
   */
  protected removeVariable(id: string): void {
    this.writeVariables((variables: readonly HttpField[]): readonly HttpField[] =>
      variables.filter((variable: HttpField): boolean => variable.id !== id),
    );
  }

  /**
   * Applies a transformation to the active environment's variables and writes them back.
   * @param transform The transformation to apply.
   */
  private writeVariables(
    transform: (variables: readonly HttpField[]) => readonly HttpField[],
  ): void {
    const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
    if (environment !== null) {
      this.workspace.setVariables(environment.id, transform(environment.variables));
    }
  }
}
