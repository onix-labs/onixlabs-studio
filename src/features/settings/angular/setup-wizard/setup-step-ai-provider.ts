import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { AiConnection } from '@shared/api/ai-types';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { Settings } from '@shared/angular/services/settings/settings';
import { AiConnectionEditor } from '@features/settings/angular/settings-view/sections/ai-settings/ai-connection-editor/ai-connection-editor';

/**
 * The setup wizard's AI provider step: which provider Studio talks to, and whether it can actually
 * reach it.
 *
 * The last part is what makes this a step rather than a form. A credential that is wrong is
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
  imports: [Button, Dropdown, SettingRow, AiConnectionEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-ai-provider.scss',
  template: `
    @if (!connections.isAvailable) {
      <p class="ai__unavailable">
        AI providers cannot be configured outside the desktop application.
      </p>
    } @else {
      <app-setting-row
        label="Provider"
        description="The connection the agent runs turns through. You can add more, and change this, in Settings afterwards."
      >
        <app-dropdown
          [options]="options()"
          [value]="activeId()"
          ariaLabel="Active AI connection"
          (valueChange)="choose($event)"
        />
      </app-setting-row>

      @if (active(); as connection) {
        <app-ai-connection-editor [connection]="connection" />

        <div class="ai__verify">
          <app-button
            label="Check this provider"
            [loading]="checking()"
            (click)="verify()"
            tooltip="Confirm the credential works before you leave this step"
          />
          @if (verdict(); as message) {
            <span class="ai__verdict" [class.ai__verdict--bad]="!reachable()">{{ message }}</span>
          }
        </div>
      }

      <p class="ai__note">
        Leaving this unset is fine — everything except the agent works without it, and the agent
        will ask when you first use it.
      </p>
    }
  `,
})
export class SetupStepAiProvider {
  /**
   * Holds the connection registry, exposed for the template.
   */
  protected readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the settings store the active connection is persisted in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds whether a credential check is in flight.
   */
  private readonly inFlight: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the outcome of the last check, or null before one has been run.
   */
  private readonly lastVerdict: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the last check found the provider reachable.
   */
  private readonly lastReachable: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether a credential check is in flight.
   */
  protected readonly checking: Signal<boolean> = this.inFlight.asReadonly();

  /**
   * Gets the outcome of the last check.
   */
  protected readonly verdict: Signal<string | null> = this.lastVerdict.asReadonly();

  /**
   * Gets whether the last check found the provider reachable.
   */
  protected readonly reachable: Signal<boolean> = this.lastReachable.asReadonly();

  /**
   * Gets the identifier of the active connection.
   */
  protected readonly activeId: Signal<string> = this.settings.aiActiveConnectionId;

  /**
   * Gets the active connection, or undefined when the stored identifier names none.
   */
  protected readonly active: Signal<AiConnection | undefined> = this.settings.aiActiveConnection;

  /**
   * Gets the connections to choose between.
   */
  protected readonly options: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.connections.connections().map((connection: AiConnection): DropdownOption => ({
        value: connection.id,
        label: connection.label,
      })),
  );

  /**
   * Makes a connection the active one.
   * @param id The connection identifier.
   */
  protected choose(id: string): void {
    this.settings.set('ai.activeConnectionId', id);
    // The previous verdict was about a different provider, so it is no longer an answer to anything.
    this.lastVerdict.set(null);
  }

  /**
   * Checks whether the active connection's credential actually works, and says so.
   */
  protected async verify(): Promise<void> {
    const connection: AiConnection | undefined = this.active();
    if (connection === undefined) {
      return;
    }
    this.inFlight.set(true);
    try {
      await this.connections.refreshAuth(connection);
      const available: boolean = this.connections.authStatus(connection.id).available;
      this.lastReachable.set(available);
      this.lastVerdict.set(
        available
          ? `${connection.label} answered. The agent is ready to use.`
          : `${connection.label} did not answer. Check the credential above.`,
      );
    } finally {
      this.inFlight.set(false);
    }
  }
}
