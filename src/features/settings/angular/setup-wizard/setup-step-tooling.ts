import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { PluginSummary } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The setup wizard's tooling step: the plugins that decide what Studio can actually open and run.
 *
 * Studio ships with no container engine, no decoder and no third-party language server — each is a
 * plugin, by the ruling that made them one. That is the right architecture and a poor first
 * impression: a fresh installation opens the Containers tab to nothing at all, and "nothing is
 * running" is the wrong sentence when nothing is *installed*. This is where that gets said once,
 * before it is discovered as an empty panel.
 *
 * Installed plugins stay in the list rather than being summarised away beneath it. The list is long
 * enough to need filtering, and a filter that hides half its subject is a filter that lies — a user
 * searching for "rust" wants to know it is already there just as much as they want to install it.
 *
 * Installing goes through the same consent the Plugin Manager asks for. A wizard is another entry
 * point to an install, never a shortcut past the question.
 */
@Component({
  selector: 'app-setup-step-tooling',
  imports: [Button, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-tooling.scss',
  template: `
    <app-text-field
      class="tooling__filter"
      kind="search"
      placeholder="Filter by name or description"
      ariaLabel="Filter plugins"
      [(value)]="filter"
    />

    @if (matching().length === 0) {
      <p class="tooling__empty">
        @if (filter().trim().length > 0) {
          Nothing matches “{{ filter() }}”.
        } @else {
          No plugins are available on this machine.
        }
      </p>
    } @else {
      <ul class="tooling__list">
        @for (plugin of matching(); track plugin.id) {
          <li class="tooling__item">
            <span class="tooling__text">
              <span class="tooling__name">{{ plugin.name }}</span>
              <span class="tooling__detail">{{ plugin.description }}</span>
            </span>
            @if (plugin.state === 'installed') {
              <span class="tooling__state">Installed</span>
            } @else {
              <app-button
                label="Install"
                [disabled]="plugins.busy()"
                (click)="install(plugin.id)"
              />
            }
          </li>
        }
      </ul>
    }

    @if (plugins.error(); as failure) {
      <p class="tooling__error">{{ failure }}</p>
    }
  `,
})
export class SetupStepTooling {
  /**
   * Holds the plugin client, exposed for the template.
   */
  protected readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the text the list is filtered by.
   */
  protected readonly filter: WritableSignal<string> = signal<string>('');

  /**
   * Gets the plugins to list: everything the catalogue knows, matching the filter, with what is not
   * installed first — the list exists to be acted on, so the actionable rows lead it.
   */
  protected readonly matching: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => {
      const needle: string = this.filter().trim().toLowerCase();
      return this.plugins
        .plugins()
        .filter(
          (plugin: PluginSummary): boolean =>
            needle.length === 0 ||
            plugin.name.toLowerCase().includes(needle) ||
            plugin.description.toLowerCase().includes(needle),
        )
        .toSorted((left: PluginSummary, right: PluginSummary): number =>
          left.state === right.state ? 0 : left.state === 'installed' ? 1 : -1,
        );
    },
  );

  /**
   * Installs a plugin, through the same terms the Plugin Manager asks for.
   * @param id The plugin identifier.
   */
  protected install(id: string): void {
    void this.plugins.installWithConsent(id);
  }
}
