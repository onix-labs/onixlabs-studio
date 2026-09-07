import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import {
  SHELL_PICKER_DEFAULT,
  ShellPicker,
} from '@shared/angular/components/forms/shell-picker/shell-picker';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalSettingsSection } from '@features/settings/angular/settings-view/sections/terminal-settings/terminal-settings';

/**
 * The setup wizard's terminal step: which shell new terminals start with, and which shell the agent
 * takes its environment from.
 *
 * The two are asked together — and asked at all — because they are the same class of quiet failure.
 * A wrong shell here does not fail; it produces a PATH that is missing something, and the symptom
 * arrives much later as a language server that never starts or an agent that cannot find a tool it
 * was told to use.
 *
 * The default-shell row is the settings section itself rather than a copy of it, so the two surfaces
 * cannot drift. Neither setting is generically renderable — the installed shells are discovered at
 * runtime — which is why this step is a component rather than a list of keys.
 */
@Component({
  selector: 'app-setup-step-terminal',
  imports: [SettingRow, ShellPicker, TerminalSettingsSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../settings-view/sections/section.scss'],
  template: `
    <app-terminal-settings />

    <app-setting-row
      label="Agent shell"
      description="The shell whose profile the agent sources its environment (PATH, tokens) from. If a tool works in your terminal but the agent cannot find it, this is usually why."
    >
      <app-shell-picker
        defaultLabel="Default login shell"
        [value]="agentShell()"
        (valueChange)="onAgentShellChange($event)"
      />
    </app-setting-row>
  `,
})
export class SetupStepTerminal {
  /**
   * Holds the settings service the agent shell persists through.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the persisted agent shell (the empty string for the default login shell).
   */
  protected readonly agentShell: Signal<string> = this.settings.aiAgentShell;

  /**
   * Persists the chosen agent shell.
   * @param value The chosen shell path, or the empty string for the default login shell.
   */
  protected onAgentShellChange(value: string): void {
    this.log.info(
      'SetupWizard',
      'Agent shell changed',
      value === SHELL_PICKER_DEFAULT ? 'default login shell' : value,
    );
    this.settings.set('ai.agentShell', value);
  }
}
