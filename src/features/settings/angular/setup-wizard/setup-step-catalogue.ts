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
import { Icon } from '@shared/angular/icons/icon';
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
 * Installing goes through the same consent the Plugin Manager asks for. A wizard is another entry
 * point to an install, never a shortcut past the question. What is installed can be removed here
 * too, so a plugin tried during setup is not one the user must go elsewhere to take back out.
 */
@Component({
  selector: 'app-setup-step-catalogue',
  imports: [Button],
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
            <!-- The same actions, icons and words as the Plugin Manager's rows, so a plugin
                 installed here can be taken out again here. A row being removed keeps its Remove
                 button, spinning, rather than flipping to Install while it works. -->
            @if (plugin.state === 'installed' || removing().has(plugin.id)) {
              <app-button
                variant="solid"
                tone="danger"
                label="Remove"
                [icon]="Icon.TRASH_SIMPLE"
                [disabled]="plugins.busy()"
                [loading]="plugin.state === 'busy'"
                (click)="uninstall(plugin.id)"
              />
            } @else if (plugin.state === 'unavailable') {
              <span class="catalogue__state">Not available here</span>
            } @else {
              <app-button
                variant="solid"
                label="Install"
                [icon]="Icon.DOWNLOAD"
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
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the plugins being removed from here, so a row mid-removal keeps showing what it is doing.
   */
  private readonly removingIds: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the plugins being removed from here.
   */
  protected readonly removing: Signal<ReadonlySet<string>> = this.removingIds.asReadonly();

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

  /**
   * Installs a plugin, through the same terms the Plugin Manager asks for.
   * @param id The plugin identifier.
   */
  protected install(id: string): void {
    void this.plugins.installWithConsent(id);
  }

  /**
   * Removes a plugin, as the Plugin Manager's Remove does.
   * @param id The plugin identifier.
   * @returns Returns a promise that settles once the removal has.
   */
  protected async uninstall(id: string): Promise<void> {
    this.removingIds.update((ids: ReadonlySet<string>): ReadonlySet<string> =>
      new Set<string>(ids).add(id),
    );
    try {
      await this.plugins.uninstall(id);
    } finally {
      this.removingIds.update((ids: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(ids);
        next.delete(id);
        return next;
      });
    }
  }
}
