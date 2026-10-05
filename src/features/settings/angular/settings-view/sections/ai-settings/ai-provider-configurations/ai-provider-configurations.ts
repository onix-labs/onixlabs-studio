import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AiAuthStatus, AiConnection, AuthMethod, ProviderPage } from '@shared/api/ai-types';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Log } from '@shared/angular/services/log/log';
import { AiConnectionEditor } from '../ai-connection-editor/ai-connection-editor';

/**
 * One provider's configurations: a button per way of signing in the provider offers, and an
 * expandable editor per configuration already made.
 *
 * Shared by the settings view's provider page and the setup wizard's provider step, so signing in to
 * a provider looks and behaves the same wherever it is done. The sign-in buttons stay put after one
 * is used — a provider offering both a subscription and an API key can be given both — and the new
 * configuration opens beneath them, ready for its credential.
 */
@Component({
  selector: 'app-ai-provider-configurations',
  imports: [Accordion, Button, AiConnectionEditor],
  templateUrl: './ai-provider-configurations.html',
  styleUrl: './ai-provider-configurations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiProviderConfigurations {
  /**
   * Gets the id of the provider page whose configurations are shown (for example `anthropic`).
   */
  public readonly pageId: InputSignal<string> = input.required<string>();

  /**
   * Emits each configuration added here, once it exists.
   */
  public readonly added: OutputEmitterRef<AiConnection> = output<AiConnection>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the connection-management service.
   */
  private readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the providers installed plugins contribute.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the ids of the currently-expanded configurations.
   */
  private readonly expandedIds: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets a value indicating whether the agent bridge is available.
   */
  protected readonly isAvailable: boolean = this.connections.isAvailable;

  /**
   * Gets the provider page, or undefined when it names no installed provider.
   */
  protected readonly page: Signal<ProviderPage | undefined> = computed(
    (): ProviderPage | undefined =>
      this.providers.pages().find((page: ProviderPage): boolean => page.id === this.pageId()),
  );

  /**
   * Gets the configurations that belong to the provider (every connection of its kind(s)).
   */
  protected readonly pageConnections: Signal<readonly AiConnection[]> = computed(
    (): readonly AiConnection[] => {
      const page: ProviderPage | undefined = this.page();
      return page === undefined ? [] : this.connections.connectionsForKinds(page.kinds);
    },
  );

  /**
   * Initialises the list, refreshing every configuration's auth status.
   */
  public constructor() {
    void this.connections.refreshAllAuth();
  }

  /**
   * Reports whether a configuration is expanded.
   * @param id The connection id.
   * @returns Returns true when the configuration is expanded.
   */
  protected isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

  /**
   * Records a configuration's expanded state, as reported by its accordion.
   * @param id The connection id.
   * @param expanded True when the configuration is expanded.
   */
  protected setExpanded(id: string, expanded: boolean): void {
    this.expandedIds.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      if (expanded) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /**
   * Gets a configuration's auth status.
   * @param id The connection id.
   * @returns Returns the status.
   */
  protected status(id: string): AiAuthStatus {
    return this.connections.authStatus(id);
  }

  /**
   * Adds a configuration through the given authentication method and expands it.
   * @param method The authentication method the configuration is added through.
   */
  protected addConfiguration(method: AuthMethod): void {
    const page: ProviderPage | undefined = this.page();
    if (page === undefined) {
      return;
    }
    const connection: AiConnection = this.connections.add(page.createKind, method);
    this.log.info('settings.ai', 'Configuration added', connection.id, connection.auth);
    this.setExpanded(connection.id, true);
    this.added.emit(connection);
  }

  /**
   * Deletes a configuration, from the delete action on its header.
   * @param connection The configuration.
   */
  protected remove(connection: AiConnection): void {
    this.log.info('settings.ai', 'Configuration removed', connection.id);
    this.connections.remove(connection.id);
    this.setExpanded(connection.id, false);
  }
}
