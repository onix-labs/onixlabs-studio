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
import type { AiConnection, AuthMethod, ProviderPage } from '@shared/api/ai-types';
import { providerDisplayLabel } from '@shared/api/ai-types';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Settings } from '@shared/angular/services/settings/settings';
import { AiConnectionEditor } from '@features/settings/angular/settings-view/sections/ai-settings/ai-connection-editor/ai-connection-editor';

/**
 * Which of the step's stages is showing. Derived from what exists rather than counted, so that
 * deleting a configuration moves the step on its own, and the stage can never disagree with the
 * state it describes.
 */
type Stage = 'gone' | 'choose' | 'verify';

/**
 * The outcome of the last live check, remembered against the configuration it was about. A verdict
 * on one configuration is not an answer about another, so it is shown only while that one is chosen.
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
 * The setup wizard's step for one AI provider, which does one job: get it working.
 *
 * A leaf beneath the AI Providers step, one per provider an installed plugin offers, exactly as the
 * settings tree grows them. It walks **choose → verify**: how to sign in — which creates the
 * configuration the way the settings page does, so it names the plugin that runs it from the
 * start — then the credential and a live check that the provider actually answers.
 *
 * The check is what makes this a step rather than a form. A credential that is wrong is
 * indistinguishable from one that is right until something tries to use it, and the thing that tries
 * is the user's first question to the agent — which is exactly the wrong moment to find out. So the
 * step checks, here, and says what it found.
 *
 * The connection editor is the settings view's own, not a copy: setting a key is fiddly, provider-
 * specific work, and a second implementation of it in the wizard would be a second thing to keep
 * right.
 */
@Component({
  selector: 'app-setup-step-ai-provider',
  imports: [Button, AppIcon, AiConnectionEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-ai-provider.scss',
  template: `
    @if (!connections.isAvailable) {
      <p class="ai__hint">Checking a provider is only possible inside Studio.</p>
    }

    @switch (stage()) {
      @case ('gone') {
        <p class="ai__hint">The plugin that offered this provider is no longer installed.</p>
      }
      @case ('choose') {
        @if (page(); as page) {
          @if (pageConnections().length > 0) {
            <p class="ai__lead">Use a configuration you already have, or add another below.</p>
            <ul class="ai__list">
              @for (connection of pageConnections(); track connection.id) {
                <li class="ai__item">
                  <span class="ai__text">
                    <span class="ai__name">{{ labelFor(connection) }}</span>
                  </span>
                  <app-button label="Use" (click)="use(connection.id)" />
                </li>
              }
            </ul>
          } @else {
            <p class="ai__lead">{{ page.description }}</p>
          }
          <div class="ai__item">
            <span class="ai__text">
              <span class="ai__name">How you sign in</span>
              <span class="ai__detail"
                >Each adds a configuration; you can add more in Settings.</span
              >
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
          </div>
        }
      }
      @case ('verify') {
        @if (chosen(); as connection) {
          <!-- The check leads, above the editor rather than below it. The editor is tall enough
               that anything after it is below the fold, and the check is the point of the step;
               the editor is there for what the check turns out to need. -->
          <div class="ai__chosen">
            <span class="ai__text">
              <span class="ai__name">{{ labelFor(connection) }}</span>
              @if (verdict(); as verdict) {
                <span class="ai__verdict" [class.ai__verdict--bad]="!verdict.reachable">
                  <app-icon
                    [icon]="verdict.reachable ? Icon.SUCCESS_FILL : Icon.WARNING_FILL"
                    [size]="0.9"
                  />
                  {{ verdict.message }}
                </span>
              } @else {
                <span class="ai__detail">The configuration the agent runs turns through.</span>
              }
            </span>
            <span class="ai__methods">
              <app-button label="Change" (click)="change()" />
              <app-button
                variant="solid"
                label="Check this provider"
                [disabled]="!connections.isAvailable"
                [loading]="checking()"
                (click)="verify()"
                tooltip="Confirm the credential works before you leave this step"
              />
            </span>
          </div>

          <app-ai-connection-editor [connection]="connection" />
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
   * Gets the identifier of the provider page this step signs in to.
   */
  public readonly pageId: InputSignal<string> = input.required<string>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the providers installed plugins contribute.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the connection registry, exposed for the template.
   */
  protected readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the settings store the active connection is persisted in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds whether the user has asked to choose again despite having a chosen configuration.
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
   * Gets the provider page, or undefined once the plugin that offered it is gone.
   */
  protected readonly page: Signal<ProviderPage | undefined> = computed(
    (): ProviderPage | undefined =>
      this.providers.pages().find((page: ProviderPage): boolean => page.id === this.pageId()),
  );

  /**
   * Gets the configurations that belong to this provider.
   */
  protected readonly pageConnections: Signal<readonly AiConnection[]> = computed(
    (): readonly AiConnection[] => {
      const page: ProviderPage | undefined = this.page();
      return page === undefined ? [] : this.connections.connectionsForKinds(page.kinds);
    },
  );

  /**
   * Gets the configuration this step is verifying: the active one, when it belongs to this provider.
   * Another provider's active configuration is not this step's to show.
   */
  protected readonly chosen: Signal<AiConnection | undefined> = computed(
    (): AiConnection | undefined => {
      const active: AiConnection | undefined = this.settings.aiActiveConnection();
      const page: ProviderPage | undefined = this.page();
      return active !== undefined && page?.kinds.includes(active.kind) ? active : undefined;
    },
  );

  /**
   * Gets the stage to show. No page: the plugin is gone. No chosen configuration, or the user asked
   * to choose again: choose. Otherwise: verify.
   */
  protected readonly stage: Signal<Stage> = computed((): Stage => {
    if (this.page() === undefined) {
      return 'gone';
    }
    if (this.chosen() === undefined || this.choosing()) {
      return 'choose';
    }
    return 'verify';
  });

  /**
   * Gets the outcome of the last check, when it was about the configuration chosen now.
   */
  protected readonly verdict: Signal<Verdict | null> = computed((): Verdict | null => {
    const verdict: Verdict | null = this.lastVerdict();
    return verdict !== null && verdict.connectionId === this.chosen()?.id ? verdict : null;
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
   * Creates a configuration for the provider through one of its sign-in methods and makes it the
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
   * Goes back to choosing, keeping the chosen configuration in case the user returns to it.
   */
  protected change(): void {
    this.choosing.set(true);
  }

  /**
   * Checks whether the chosen configuration's credential actually works, and says so.
   */
  protected async verify(): Promise<void> {
    const connection: AiConnection | undefined = this.chosen();
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
