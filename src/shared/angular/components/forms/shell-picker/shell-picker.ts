import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { ShellInfo } from '@shared/api/terminal-channels';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';

/**
 * Holds the value that means "no shell chosen — leave it to the host". Every consumer persists the
 * same empty string; only the label they put on it differs, because what the host resolves it to is
 * not the same thing in each case (a terminal's default shell, or the profile an agent's environment
 * is sourced from).
 */
export const SHELL_PICKER_DEFAULT: string = '';

/**
 * Picks a shell from those installed on the host, with a leading entry that defers the choice.
 *
 * The options cannot be stated in the settings registry because they are discovered at runtime, so
 * every surface that offers this choice has to build the list itself. Three now do — the Terminal
 * settings section, the AI settings section, and the setup wizard's terminal step — and before this
 * existed the first two carried the same mapping twice, differing only in the label on the leading
 * entry. That label is the input; everything else is shared.
 */
@Component({
  selector: 'app-shell-picker',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dropdown
      [options]="options()"
      [value]="value()"
      [disabled]="disabled()"
      [ariaLabel]="ariaLabel()"
      (valueChange)="valueChange.emit($event)"
    />
  `,
})
export class ShellPicker {
  /**
   * Holds the installed-shells provider populating the list.
   */
  private readonly shells: TerminalShells = inject(TerminalShells);

  /**
   * Gets the selected shell path, or the empty string for the deferred default.
   */
  public readonly value: InputSignal<string> = input<string>(SHELL_PICKER_DEFAULT);

  /**
   * Gets the label of the leading entry that defers the choice to the host.
   */
  public readonly defaultLabel: InputSignal<string> = input.required<string>();

  /**
   * Gets whether the picker is disabled.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the accessible label announced for the picker, for a call site that does not label it with
   * a visible setting row.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Emitted when a shell is chosen, carrying its path (or the empty string for the default).
   */
  public readonly valueChange: OutputEmitterRef<string> = output<string>();

  /**
   * Gets the options: the deferring entry, then each installed shell.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: SHELL_PICKER_DEFAULT, label: this.defaultLabel() },
      ...this.shells
        .shells()
        .map((shell: ShellInfo): DropdownOption => ({ value: shell.path, label: shell.name })),
    ],
  );
}
