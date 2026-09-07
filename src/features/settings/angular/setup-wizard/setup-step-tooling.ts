import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { PluginSummary } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
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
 * Installing goes through the same consent the Plugin Manager asks for. A wizard is another entry
 * point to an install, never a shortcut past the question.
 */
@Component({
  selector: 'app-setup-step-tooling',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-tooling.scss',
  template: `
    @if (!plugins.busy() && available().length === 0) {
      <p class="tooling__empty">
        @if (installed().length > 0) {
          Everything in the catalogue is already installed. You can manage plugins later from the
          Plugin Manager.
        } @else {
          No plugins are available to install on this machine.
        }
      </p>
    } @else {
      <ul class="tooling__list">
        @for (plugin of available(); track plugin.id) {
          <li class="tooling__item">
            <span class="tooling__text">
              <span class="tooling__name">{{ plugin.name }}</span>
              <span class="tooling__detail">{{ plugin.description }}</span>
            </span>
            <app-button label="Install" [disabled]="plugins.busy()" (click)="install(plugin.id)" />
          </li>
        }
      </ul>
    }

    @if (plugins.error(); as failure) {
      <p class="tooling__error">{{ failure }}</p>
    }

    @if (installed().length > 0) {
      <p class="tooling__installed">Already installed: {{ installedNames() }}</p>
    }
  `,
})
export class SetupStepTooling {
  /**
   * Holds the plugin client, exposed for the template.
   */
  protected readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets the plugins that are not installed, which are the ones there is anything to decide about.
   */
  protected readonly available: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      this.plugins
        .plugins()
        .filter((plugin: PluginSummary): boolean => plugin.state !== 'installed'),
  );

  /**
   * Gets the plugins already installed, reported rather than listed for action — so a user who has
   * been here before is told the step is not asking them to do anything twice.
   */
  protected readonly installed: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      this.plugins
        .plugins()
        .filter((plugin: PluginSummary): boolean => plugin.state === 'installed'),
  );

  /**
   * Gets the installed plugins' names, as a sentence.
   */
  protected readonly installedNames: Signal<string> = computed((): string =>
    this.installed()
      .map((plugin: PluginSummary): string => plugin.name)
      .join(', '),
  );

  /**
   * Installs a plugin, through the same terms the Plugin Manager asks for.
   * @param id The plugin identifier.
   */
  protected install(id: string): void {
    void this.plugins.installWithConsent(id);
  }
}
