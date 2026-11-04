import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  Signal,
} from '@angular/core';
import type { ContainerEngineInfo } from '@shared/api/container-types';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';
import { ContainersClient } from '@features/containers/angular/client/containers-client';

/**
 * The value that leaves the choice to Studio: the highest-priority engine that is running.
 */
const AUTOMATIC: string = 'automatic';

/**
 * Represents the Container Engine row on Containers › General: Automatic, or one of the installed
 * engines. The choice is also main's, which picks the engine before any window exists, so a change goes
 * there as well as into the settings store.
 */
@Component({
  selector: 'app-container-engine',
  imports: [Dropdown, SettingRow],
  template: `
    <app-setting-row
      label="Container Engine"
      description="Which installed engine Studio talks to. Automatic picks the first one running."
    >
      <app-dropdown
        ariaLabel="Container Engine"
        [options]="options()"
        [value]="value()"
        (valueChange)="choose($event)"
      />
    </app-setting-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerEngine implements OnInit {
  /**
   * Holds the engine client.
   */
  private readonly client: ContainersClient = inject(ContainersClient);

  /**
   * Holds the settings store.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the engine chosen.
   */
  protected readonly value: Signal<string> = this.settings.value('containers.engine');

  /**
   * Gets the choices: Automatic and the installed engines.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: AUTOMATIC, label: 'Automatic' },
      ...this.client.containerEngines().map((engine: ContainerEngineInfo): DropdownOption => ({
        value: engine.id,
        label: engine.displayName,
      })),
    ],
  );

  /**
   * Asks main which engines are installed.
   */
  public ngOnInit(): void {
    void this.client.refreshEngines();
  }

  /**
   * Chooses an engine.
   * @param id The engine's id, or {@link AUTOMATIC}.
   */
  protected choose(id: string): void {
    this.settings.set('containers.engine', id);
    void this.client.chooseEngine(id === AUTOMATIC ? null : id);
  }
}
