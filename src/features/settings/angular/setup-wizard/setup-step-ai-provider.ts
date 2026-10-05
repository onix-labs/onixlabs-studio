import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import type { AiConnection, ProviderPage } from '@shared/api/ai-types';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Settings } from '@shared/angular/services/settings/settings';
import { AiProviderConfigurations } from '@features/settings/angular/settings-view/sections/ai-settings/ai-provider-configurations/ai-provider-configurations';

/**
 * The setup wizard's step for one AI provider: its configurations, exactly as the provider's settings
 * page shows them.
 *
 * A leaf beneath the AI Providers step, one per provider an installed plugin offers, as the settings
 * tree grows them. The list is the settings page's own component rather than a wizard version of it:
 * signing in is fiddly, provider-specific work, and a provider offering both a subscription and an
 * API key must be able to take both here just as it can there.
 *
 * What the wizard adds is the active choice. A first configuration made here becomes the one the
 * agent runs through, so finishing setup leaves an agent ready to use; a later one leaves the user's
 * existing choice alone.
 */
@Component({
  selector: 'app-setup-step-ai-provider',
  imports: [AiProviderConfigurations],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-ai-provider.scss',
  template: `
    @if (page() === undefined) {
      <p class="ai__hint">The plugin that offered this provider is no longer installed.</p>
    } @else {
      <app-ai-provider-configurations [pageId]="pageId()" (added)="adopt($event)" />
    }

    <p class="ai__note">
      Leaving this unset is fine — everything except the agent works without it, and the agent will
      say what it needs when you first use it.
    </p>
  `,
})
export class SetupStepAiProvider {
  /**
   * Gets the identifier of the provider page this step signs in to.
   */
  public readonly pageId: InputSignal<string> = input.required<string>();

  /**
   * Holds the providers installed plugins contribute.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the settings store the active connection is persisted in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the provider page, or undefined once the plugin that offered it is gone.
   */
  protected readonly page: Signal<ProviderPage | undefined> = computed(
    (): ProviderPage | undefined =>
      this.providers.pages().find((page: ProviderPage): boolean => page.id === this.pageId()),
  );

  /**
   * Makes a configuration just added the active one, when nothing is active yet.
   * @param connection The configuration added.
   */
  protected adopt(connection: AiConnection): void {
    if (this.settings.aiActiveConnection() === undefined) {
      this.settings.set('ai.activeConnectionId', connection.id);
    }
  }
}
