import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import type { AiConnection, AuthMethod, ProviderPage } from '@shared/api/ai-types';
import { providerDisplayLabel } from '@shared/api/ai-types';
import type { PluginContribution, PluginSummary } from '@shared/api/plugin-channels';
import { slotCandidates } from '@shared/api/plugin-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Settings } from '@shared/angular/services/settings/settings';
import { AiConnectionEditor } from '@features/settings/angular/settings-view/sections/ai-settings/ai-connection-editor/ai-connection-editor';

/**
 * Which of the step's three stages is showing. Derived from what exists rather than counted, so that
 * installing a plugin or deleting a configuration moves the step on its own, and the stage can never
 * disagree with the state it describes.
 */
type Stage = 'install' | 'choose' | 'verify';

/**
 * The outcome of the last live check, remembered against the configuration it was about. A verdict
 * on one configuration is not an answer about another, so it is shown only while that one is active.
 */
interface Verdict {
  /**
   * Gets the identifier of the configuration the check was run against.
   */
  readonly connectionId: string;

  /**
   * Gets whether the provider answered.
   */
  readonly reachable: boolean;

  /**
   * Gets the sentence saying what happened.
   */
  readonly message: string;
}

/**
 * Tests whether a contribution is an agent harness — the slot a provider plugin fills.
 * @param contribution The contribution to test.
 * @returns Returns true for an agent harness.
 */
function isHarness(contribution: PluginContribution): boolean {
  return contribution.slot === 'agent-harness';
}

/**
 * The setup wizard's AI provider step, which does one job: get a single provider working.
 *
 * Studio ships no AI provider of its own (#653) — each is a plugin — so on a first run there is nothing
 * to configure until one is installed. The step therefore walks **install → choose → verify**: which
 * plugin, then which of the providers it offers and how to sign in to it, then the credential and a
 * live check that it actually answers. Install gates the choice, following the ruling every other
 * slot follows: a chooser offered before anything is installed is a dropdown with nothing in it.
 *
 * The last part is what makes this a step rather than a form. A credential that is wrong is
 * indistinguishable from one that is right until something tries to use it, and the thing that tries
 * is the user's first question to the agent — which is exactly the wrong moment to find out. So the
 * step checks, here, and says what it found.
 *
 * The connection editor is the settings view's own, not a copy: setting a key is fiddly, provider-
 * specific work, and a second implementation of it in the wizard would be a second thing to keep
 * right. Choosing a provider creates the configuration the same way the settings page does, so the
 * configuration already names the plugin that runs it.
 */
@Component({
  selector: 'app-setup-step-ai-provider',
  imports: [Button, AppIcon, AiConnectionEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-ai-provider.scss',
  template: `
    @if (!connections.isAvailable) {
      <p class="ai__hint">Installing and checking a provider is only possible inside Studio.</p>
    }

    @switch (stage()) {
      @case ('install') {
        <p class="ai__lead">
          Studio runs agents through provider plugins, so the stack is yours to choose. Install one
          to continue; the rest can be added from the Plugin Manager at any time.
        </p>
        @if (candidates().length === 0) {
          <p class="ai__hint">No provider plugin is available on this machine.</p>
        } @else {
          <ul class="ai__list">
            @for (plugin of candidates(); track plugin.id) {
              <li class="ai__item">
                <span class="ai__text">
                  <span class="ai__name">{{ plugin.name }}</span>
                  <span class="ai__detail">{{ plugin.description }}</span>
                </span>
                <app-button
                  label="Install"
                  [disabled]="plugins.busy()"
                  [loading]="plugins.busy() && plugin.state === 'busy'"
                  (click)="install(plugin.id)"
                />
              </li>
            }
          </ul>
        }
        @if (plugins.error(); as failure) {
          <p class="ai__error">{{ failure }}</p>
        }
      }
      @case ('choose') {
        @if (connections.connections().length > 0) {
          <p class="ai__lead">Use a configuration you already have, or add another below.</p>
          <ul class="ai__list">
            @for (connection of connections.connections(); track connection.id) {
              <li class="ai__item">
                <span class="ai__text">
                  <span class="ai__name">{{ labelFor(connection) }}</span>
                </span>
                <app-button label="Use" (click)="use(connection.id)" />
              </li>
            }
          </ul>
        } @else {
          <p class="ai__lead">Choose a provider, and how you sign in to it.</p>
        }
        <ul class="ai__list">
          @for (page of providers.pages(); track page.id) {
            <li class="ai__item">
              <span class="ai__text">
                <span class="ai__name">{{ page.label }}</span>
                <span class="ai__detail">{{ page.description }}</span>
              </span>
              <span class="ai__methods">
                @for (method of page.methods; track method.auth) {
                  <app-button
                    variant="solid"
                    [icon]="Icon.PLUS"
                    [label]="method.buttonLabel"
                    (click)="choose(page, method)"
                  />
                }
              </span>
            </li>
          }
        </ul>
      }
      @case ('verify') {
        @if (active(); as connection) {
          <div class="ai__chosen">
            <span class="ai__text">
              <span class="ai__name">{{ labelFor(connection) }}</span>
              <span class="ai__detail">The configuration the agent runs turns through.</span>
            </span>
            <app-button label="Change" (click)="change()" />
          </div>

          <app-ai-connection-editor [connection]="connection" />

          <div class="ai__verify">
            <app-button
              variant="solid"
              label="Check this provider"
              [disabled]="!connections.isAvailable"
              [loading]="checking()"
              (click)="verify()"
              tooltip="Confirm the credential works before you leave this step"
            />
            @if (verdict(); as verdict) {
              <span class="ai__verdict" [class.ai__verdict--bad]="!verdict.reachable">
                <app-icon
                  [icon]="verdict.reachable ? Icon.SUCCESS_FILL : Icon.WARNING_FILL"
                  [size]="0.9"
                />
                {{ verdict.message }}
              </span>
            }
          </div>
        }
      }
    }

    <p class="ai__note">
      Leaving this unset is fine — everything except the agent works without it, and the agent will
      say what it needs when you first use it.
    </p>
  `,
})
export class SetupStepAiProvider {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the plugin client, exposed for the template.
   */
  protected readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the providers installed plugins contribute, exposed for the template.
   */
  protected readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the connection registry, exposed for the template.
   */
  protected readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the settings store the active connection is persisted in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds whether the user has asked to choose again despite having an active configuration.
   */
  private readonly choosing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether a credential check is in flight.
   */
  private readonly inFlight: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the outcome of the last check, or null before one has been run.
   */
  private readonly lastVerdict: WritableSignal<Verdict | null> = signal<Verdict | null>(null);

  /**
   * Gets whether a credential check is in flight.
   */
  protected readonly checking: Signal<boolean> = this.inFlight.asReadonly();

  /**
   * Gets the active connection, or undefined when the stored identifier names none.
   */
  protected readonly active: Signal<AiConnection | undefined> = this.settings.aiActiveConnection;

  /**
   * Gets the provider plugins that could be installed — empty once one is, because support that
   * exists is never advertised again.
   */
  protected readonly candidates: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => slotCandidates(this.plugins.plugins(), isHarness),
  );

  /**
   * Gets the stage to show. Nothing installed offers a provider: install. No active configuration,
   * or the user asked to choose again: choose. Otherwise: verify.
   */
  protected readonly stage: Signal<Stage> = computed((): Stage => {
    if (this.providers.pages().length === 0) {
      return 'install';
    }
    if (this.active() === undefined || this.choosing()) {
      return 'choose';
    }
    return 'verify';
  });

  /**
   * Gets the outcome of the last check, when it was about the configuration that is active now.
   */
  protected readonly verdict: Signal<Verdict | null> = computed((): Verdict | null => {
    const verdict: Verdict | null = this.lastVerdict();
    return verdict !== null && verdict.connectionId === this.active()?.id ? verdict : null;
  });

  /**
   * Composes the label a configuration is known by in the agent picker.
   * @param connection The configuration.
   * @returns Returns the composed label.
   */
  protected labelFor(connection: AiConnection): string {
    return providerDisplayLabel(
      this.providers.companyFor(connection.kind),
      connection.kind,
      connection.label,
    );
  }

  /**
   * Installs a provider plugin, through the same terms the Plugin Manager asks for.
   * @param id The plugin identifier.
   */
  protected install(id: string): void {
    void this.plugins.installWithConsent(id);
  }

  /**
   * Creates a configuration for a provider through one of its sign-in methods and makes it the
   * active one.
   * @param page The provider's page.
   * @param method The sign-in method.
   */
  protected choose(page: ProviderPage, method: AuthMethod): void {
    const connection: AiConnection = this.connections.add(page.createKind, method);
    this.use(connection.id);
  }

  /**
   * Makes an existing configuration the active one.
   * @param id The configuration identifier.
   */
  protected use(id: string): void {
    this.settings.set('ai.activeConnectionId', id);
    this.choosing.set(false);
  }

  /**
   * Goes back to choosing, keeping the active configuration in case the user returns to it.
   */
  protected change(): void {
    this.choosing.set(true);
  }

  /**
   * Checks whether the active configuration's credential actually works, and says so.
   */
  protected async verify(): Promise<void> {
    const connection: AiConnection | undefined = this.active();
    if (connection === undefined) {
      return;
    }
    this.inFlight.set(true);
    try {
      await this.connections.refreshAuth(connection);
      const reachable: boolean = this.connections.authStatus(connection.id).available;
      this.lastVerdict.set({
        connectionId: connection.id,
        reachable,
        message: reachable
          ? `${connection.label} answered. The agent is ready to use.`
          : `${connection.label} did not answer. Check the credential above.`,
      });
    } finally {
      this.inFlight.set(false);
    }
  }
}
