import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import type { PluginContribution, PluginSlot, PluginSummary } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * Orders a plugin for the list: what can be installed first, what cannot be installed here next, and
 * what already is last. Stated as a rank rather than a pairwise rule so the order is the same
 * whichever way round two rows are compared.
 * @param plugin The plugin.
 * @returns Returns the rank, lower first.
 */
function rank(plugin: PluginSummary): number {
  return plugin.state === 'installed' ? 2 : plugin.state === 'unavailable' ? 1 : 0;
}

/**
 * The setup wizard's catalogue step: the plugins that fill one slot, and which of them are installed.
 *
 * Studio ships with no container engine, no decoder, no language server and no AI provider — each is
 * a plugin, by the ruling that made them one. That is the right architecture and a poor first
 * impression: a fresh installation opens the Containers tab to nothing at all, and "nothing is
 * running" is the wrong sentence when nothing is *installed*. This is where that gets said once per
 * category, before it is discovered as an empty panel.
 *
 * One step per slot rather than one list of everything, because the question is asked per slot —
 * which languages, which engine, which provider — and a plugin installed here may grow a step of its
 * own beneath this one, for what it brought that has something to decide.
 *
 * Installed plugins stay in the list rather than being summarised away beneath it. A filter that
 * hides half its subject is a filter that lies — a user searching for "rust" wants to know it is
 * already there just as much as they want to install it.
 *
 * Installing goes through the same consent the Plugin Manager asks for. A wizard is another entry
 * point to an install, never a shortcut past the question.
 */
@Component({
  selector: 'app-setup-step-catalogue',
  imports: [Button, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-catalogue.scss',
  template: `
    @if (inSlot().length > 6) {
      <app-text-field
        class="catalogue__filter"
        kind="search"
        placeholder="Filter by name or description"
        ariaLabel="Filter plugins"
        [(value)]="filter"
      />
    }

    @if (matching().length === 0) {
      <p class="catalogue__empty">
        @if (filter().trim().length > 0) {
          Nothing matches “{{ filter() }}”.
        } @else {
          No plugins are available for this on this machine.
        }
      </p>
    } @else {
      <ul class="catalogue__list">
        @for (plugin of matching(); track plugin.id) {
          <li class="catalogue__item">
            <span class="catalogue__text">
              <span class="catalogue__name">{{ plugin.name }}</span>
              <span class="catalogue__detail">{{ plugin.description }}</span>
            </span>
            @if (plugin.state === 'installed') {
              <span class="catalogue__state">Installed</span>
            } @else if (plugin.state === 'unavailable') {
              <span class="catalogue__state">Not available here</span>
            } @else {
              <app-button
                label="Install"
                [disabled]="plugins.busy()"
                [loading]="plugin.state === 'busy'"
                (click)="install(plugin.id)"
              />
            }
          </li>
        }
      </ul>
    }

    @if (plugins.error(); as failure) {
      <p class="catalogue__error">{{ failure }}</p>
    }
  `,
})
export class SetupStepCatalogue {
  /**
   * Gets the slot this step installs into.
   */
  public readonly slot: InputSignal<PluginSlot> = input.required<PluginSlot>();

  /**
   * Holds the plugin client, exposed for the template.
   */
  protected readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the text the list is filtered by.
   */
  protected readonly filter: WritableSignal<string> = signal<string>('');

  /**
   * Gets every plugin that contributes into the slot, whatever its state.
   */
  protected readonly inSlot: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      this.plugins
        .plugins()
        .filter((plugin: PluginSummary): boolean =>
          plugin.contributions.some(
            (contribution: PluginContribution): boolean => contribution.slot === this.slot(),
          ),
        ),
  );

  /**
   * Gets the plugins to list: those in the slot, matching the filter, with what is not installed
   * first — the list exists to be acted on, so the actionable rows lead it.
   */
  protected readonly matching: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => {
      const needle: string = this.filter().trim().toLowerCase();
      return this.inSlot()
        .filter(
          (plugin: PluginSummary): boolean =>
            needle.length === 0 ||
            plugin.name.toLowerCase().includes(needle) ||
            plugin.description.toLowerCase().includes(needle),
        )
        .toSorted((left: PluginSummary, right: PluginSummary): number => rank(left) - rank(right));
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
