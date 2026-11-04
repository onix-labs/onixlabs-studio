import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { SEVERITIES, Severity } from '@shared/api/log-channels';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Names each severity as its tick shows it.
 */
const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

/**
 * Represents the Severities Shown by Default row on System Monitor › General: a tick for each severity.
 * The log's own filter changes them for the session, and never writes back here.
 */
@Component({
  selector: 'app-default-severities',
  imports: [Checkbox, SettingRow],
  template: `
    <app-setting-row
      label="Severities Shown by Default"
      description="What the log shows when it opens; its filter changes them for the session."
    >
      <div class="default-severities">
        @for (severity of severities; track severity) {
          <app-checkbox
            [checked]="selected().includes(severity)"
            (checkedChange)="toggle(severity, $event)"
          >
            {{ labels[severity] }}
          </app-checkbox>
        }
      </div>
    </app-setting-row>
  `,
  styles: `
    .default-severities {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
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
  protected readonly severities: readonly Severity[] = SEVERITIES;

  /**
   * Gets the name of each severity.
   */
  protected readonly labels: Readonly<Record<Severity, string>> = SEVERITY_LABELS;

  /**
   * Gets the severities ticked.
   */
  protected readonly selected: Signal<readonly Severity[]> = this.settings.value(
    'systemMonitor.defaultSeverities',
  );

  /**
   * Ticks or unticks a severity.
   * @param severity The severity.
   * @param checked Whether it is ticked.
   */
  protected toggle(severity: Severity, checked: boolean): void {
    const held: readonly Severity[] = this.selected();
    this.settings.set(
      'systemMonitor.defaultSeverities',
      SEVERITIES.filter((each: Severity): boolean =>
        each === severity ? checked : held.includes(each),
      ),
    );
  }
}
