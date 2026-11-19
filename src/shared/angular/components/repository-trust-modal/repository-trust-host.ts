import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiProviderInfo } from '@shared/api/ai-types';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { RepositoryTrustModal } from './repository-trust-modal';

/**
 * Mounts the trust question at the application root, bound to the {@link RepositoryTrust} service
 * (#1504). The main process owns the question and asks it here, one folder at a time; this only shows
 * it and sends back the answer.
 *
 * It also says when Scan with AI cannot work: the agent's plugin is too old to be kept from the folder's
 * own settings, so it would refuse to run in the folder at all. The way out is updating the plugin, not
 * trusting the folder — which is what the user was trying to decide.
 */
@Component({
  selector: 'app-repository-trust-host',
  imports: [RepositoryTrustModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-repository-trust-modal
      [question]="trust.pending()"
      [scanBlockedBy]="scanBlockedBy()"
      (accepted)="trust.answer('trusted')"
      (declined)="trust.answer('restricted')"
      (scanned)="trust.answer('scan')"
      (updateRequested)="updatePlugin()"
      (deferred)="trust.answer('later')"
      (cancelled)="trust.answer('cancel')"
    />
  `,
})
export class RepositoryTrustHost {
  /**
   * Holds the trust service whose pending question this host renders.
   */
  protected readonly trust: RepositoryTrust = inject(RepositoryTrust);

  /**
   * Holds the agent engine, which knows what the active connection's plugin can do.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Holds the tabs, to open the Plugin Manager.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Gets the name of the agent plugin that is too old to scan an untrusted folder, or null.
   */
  protected readonly scanBlockedBy: Signal<string | null> = computed((): string | null => {
    const active: string = this.engine.provider();
    const provider: AiProviderInfo | undefined = this.engine
      .providers()
      .find((candidate: AiProviderInfo): boolean => candidate.id === active);
    return provider?.ignoresUntrustedSettings === false ? provider.label : null;
  });

  /**
   * Leaves the folder untrusted, as it was, and opens the Plugin Manager to update the plugin.
   */
  protected updatePlugin(): void {
    this.trust.answer('restricted');
    this.tabs.open('plugin-manager');
  }
}
