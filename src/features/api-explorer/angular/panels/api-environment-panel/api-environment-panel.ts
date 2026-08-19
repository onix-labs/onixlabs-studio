import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ApiEnvironment, HttpField } from '@shared/api/api-client-types';
import { ApiWorkspace, newField } from '../../api-workspace/api-workspace';

/**
 * The variable editor for whichever environment is active — the values every `{{token}}` in a request
 * resolves against. Editing the *active* environment rather than offering a picker of its own is
 * deliberate: the explorer tree already chooses which environment is active, and two places to make
 * that choice would disagree.
 */
@Component({
  selector: 'app-api-environment-panel',
  imports: [Checkbox, TextField],
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
   * Gets the rows of the active environment's variables, with a trailing blank row to type into.
   */
  protected readonly rows: Signal<readonly HttpField[]> = computed((): readonly HttpField[] => {
    const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
    return environment === null ? [] : [...environment.variables, newField()];
  });

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
   * Applies a change to one variable row, dropping a row the user has blanked out entirely.
   * @param id The row identifier.
   * @param changes The row fields to change.
   */
  protected updateVariable(id: string, changes: Partial<HttpField>): void {
    const environment: ApiEnvironment | null = this.workspace.activeEnvironment();
    if (environment === null) {
      return;
    }
    const next: readonly HttpField[] = this.rows()
      .map((field: HttpField): HttpField => (field.id === id ? { ...field, ...changes } : field))
      .filter((field: HttpField): boolean => field.name !== '' || field.value !== '');
    this.workspace.setVariables(environment.id, next);
  }
}
