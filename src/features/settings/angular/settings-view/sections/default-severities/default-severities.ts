import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { SEVERITIES, Severity } from '@shared/api/log-channels';
import {
  MultiSelect,
  MultiSelectItem,
} from '@shared/angular/components/forms/multi-select/multi-select';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Names each severity in the dropdown.
 */
const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

/**
 * Represents the Severities Shown by Default row on System Monitor › General: a dropdown of severities.
 * The log's own filter changes them for the session, and never writes back here.
 */
@Component({
  selector: 'app-default-severities',
  imports: [MultiSelect, SettingRow],
  template: `
    <app-setting-row
      label="Severities Shown by Default"
      description="What the log shows when it opens; its filter changes them for the session."
    >
      <app-multi-select
        ariaLabel="Severities shown by default"
        [options]="options"
        [value]="selected()"
        (valueChange)="choose($event)"
      />
    </app-setting-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DefaultSeverities {
  /**
   * Holds the settings store.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the severities in display order.
   */
  protected readonly options: readonly MultiSelectItem[] = SEVERITIES.map(
    (severity: Severity): MultiSelectItem => ({
      value: severity,
      label: SEVERITY_LABELS[severity],
    }),
  );

  /**
   * Gets the severities chosen.
   */
  protected readonly selected: Signal<readonly Severity[]> = this.settings.value(
    'systemMonitor.defaultSeverities',
  );

  /**
   * Stores the severities chosen, in display order whatever order they were picked in.
   * @param chosen The severities chosen.
   */
  protected choose(chosen: readonly string[]): void {
    this.settings.set(
      'systemMonitor.defaultSeverities',
      SEVERITIES.filter((severity: Severity): boolean => chosen.includes(severity)),
    );
  }
}
