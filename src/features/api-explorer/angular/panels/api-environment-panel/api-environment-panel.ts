import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  PropertyGrid,
  PropertyGridEdit,
  PropertyGridRow,
} from '@shared/angular/components/property-grid/property-grid';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiEnvironment, HttpField } from '@shared/api/api-client-types';
import { ApiWorkspace } from '../../api-workspace/api-workspace';

/**
 * The variable editor for whichever environment is active — the values every `{{token}}` in a request
 * resolves against. Editing the *active* environment rather than offering a picker of its own is
 * deliberate: the explorer tree already chooses which environment is active, and two places to make
 * that choice would disagree.
 *
 * The variables are edited in the shared property grid, the same one the request's parameters, headers
 * and form fields use: they are the same shape of thing, and a variable should not feel different to
 * edit than the header it ends up in.
 */
@Component({
  selector: 'app-api-environment-panel',
  imports: [PropertyGrid, TextField],
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
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the variable syntax shown in the hint. A literal in the component rather than in the
   * template, because the template would read it as an interpolation of its own.
   */
  protected readonly variableSyntax: string = '{{name}}';

  /**
   * Renames the active environment.
   * @param name The new name.
   */
  protected rename(name: string): void {
    const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
    if (environment !== null) {
      this.workspace.renameEnvironment(environment.id, name);
    }
  }

  /**
   * Applies an edit to one variable, dropping a row the user has blanked out entirely.
   * @param edit The edit reported by the grid.
   */
  protected updateVariable(edit: PropertyGridEdit): void {
    this.writeVariables((variables: readonly HttpField[]): readonly HttpField[] =>
      variables
        .map(
          (variable: HttpField): HttpField =>
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
