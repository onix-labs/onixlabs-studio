import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import type { PluginContribution, PluginSlot, PluginSummary } from '@shared/api/plugin-channels';
import { PluginAction } from '@shared/angular/components/plugin-action/plugin-action';
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
 * Installed plugins stay in the list rather than being summarised away beneath it — a user looking
 * for Rust wants to know it is already there just as much as they want to install it. There is no
 * filter: the wizard is a pass through each category, not a search, and the Plugin Manager is where
 * the catalogue is searched.
 *
 * Each row's action is the Plugin Manager's own — Install, Update, Remove, and a progress bar while it
 * works — so a plugin reads and behaves the same in both. Installing goes through the same consent;
 * a wizard is another entry point to an install, never a shortcut past the question. What is installed
 * can be updated or removed here too, so a plugin tried during setup is not one the user must go
 * elsewhere to take back out.
 */
@Component({
  selector: 'app-setup-step-catalogue',
  imports: [PluginAction],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-catalogue.scss',
  template: `
    @if (listed().length === 0) {
      <p class="catalogue__empty">No plugins are available for this on this machine.</p>
    } @else {
      <ul class="catalogue__list">
        @for (plugin of listed(); track plugin.id) {
          <li class="catalogue__item">
            <span class="catalogue__text">
              <span class="catalogue__name">{{ plugin.name }}</span>
              <span class="catalogue__detail">{{ plugin.description }}</span>
            </span>
            <!-- The Plugin Manager's own action: Install, Update, Remove, and a progress bar while
                 it works — so a plugin installed here can be updated or taken out again here. -->
            <app-plugin-action class="catalogue__action" [plugin]="plugin" />
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
   * Gets the plugins to list: every one in the slot, whatever its state, with what is not installed
   * first — the list exists to be acted on, so the actionable rows lead it.
   */
  protected readonly listed: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      this.plugins
        .plugins()
        .filter((plugin: PluginSummary): boolean =>
          plugin.contributions.some(
            (contribution: PluginContribution): boolean => contribution.slot === this.slot(),
          ),
        )
        // The filter's array is already a copy, so sorting it in place touches nothing shared.
        .sort((left: PluginSummary, right: PluginSummary): number => rank(left) - rank(right)),
  );
}
