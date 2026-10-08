import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import type { AiAuthStatus, AiConnection, ProviderPage } from '@shared/api/ai-types';
import { providerDisplayLabel } from '@shared/api/ai-types';
import { ForgeHostAccount } from '@shared/api/forge-types';
import {
  PLUGIN_SLOT_LABELS,
  type PluginContribution,
  type PluginSlot,
  type PluginSummary,
  type UnkeyedPluginContribution,
} from '@shared/api/plugin-channels';
import { SetupProbeId, SetupProbeResult, SetupProbeStatus } from '@shared/api/setup-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Forge } from '@shared/angular/services/forge/forge';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Security } from '@shared/angular/services/security/security';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import { ChoiceOption, SettingDef } from '@shared/angular/services/settings/settings-schema';
import { Settings } from '@shared/angular/services/settings/settings';
import { SetupProbes } from '@shared/angular/services/setup-probes/setup-probes';
import { SetupWizard } from '@shared/angular/services/setup-wizard/setup-wizard';

/**
 * How a summary row turned out: a probe's statuses, plus `unset` for something simply not set up —
 * nothing installed in a category, no forge signed in to — which is a fact rather than a problem.
 */
type RowStatus = SetupProbeStatus | 'unset';

/**
 * One line of the summary.
 */
interface SummaryRow {
  /**
   * Gets the row's identity, unique within its group.
   */
  readonly id: string;

  /**
   * Gets what the row is about.
   */
  readonly name: string;

  /**
   * Gets what was found or chosen.
   */
  readonly detail: string;

  /**
   * Gets how it turned out, which decides the mark.
   */
  readonly status: RowStatus;

  /**
   * Gets the step that changes it, or undefined when no step does.
   */
  readonly stepId?: string;
}

/**
 * One section of the summary, in step order.
 */
interface SummaryGroup {
  /**
   * Gets the section heading.
   */
  readonly title: string;

  /**
   * Gets a sentence beneath the heading, or undefined for none.
   */
  readonly note?: string;

  /**
   * Gets the rows.
   */
  readonly rows: readonly SummaryRow[];
}

/**
 * Names each machine probe in the user's terms. The main process reports what it found; what the thing
 * is called is presentation, and belongs here.
 */
const PROBE_LABELS: Readonly<Record<SetupProbeId, string>> = {
  git: 'Git',
  'git-identity': 'Commit identity',
  node: 'Node.js',
  dotnet: '.NET SDK',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
  clangd: 'clangd',
};

/**
 * Holds the probes reported under Version Control rather than as language toolchains: they are about
 * the version-control plugin and how it is configured, not about a language.
 */
const VERSION_CONTROL_PROBES: readonly SetupProbeId[] = ['git', 'git-identity'];

/**
 * Holds the plugin categories reported under Plugins. AI providers and version control have groups
 * of their own, because they have more to say than which plugins are installed.
 */
const PLUGIN_GROUP_SLOTS: readonly PluginSlot[] = [
  'language-server',
  'debug-adapter',
  'decoder',
  'container-engine',
];

/**
 * The setup wizard's summary: the whole setup on one page, as the last step.
 *
 * Every step before it decides something; this one only reports. It gathers what they left — the
 * providers and whether they answer, the plugins in each category, who commits are from, the security
 * choices and the shells — and what this machine has underneath, so the user finishes knowing what
 * they have rather than having to piece it together from the steps they walked.
 *
 * The machine checks carry the wizard's original promise. Everything they report is something that
 * otherwise fails much later and for a reason that looks nothing like its cause — a C# server that
 * never starts because `dotnet` is not on the login shell's PATH, a commit refused hours in because
 * no identity was configured. A missing toolchain for a language the user does not write is a fact,
 * not a failure, and is reported as one.
 *
 * A row a step can change offers the way back to that step, rather than leaving the user to find it.
 */
@Component({
  selector: 'app-setup-step-summary',
  imports: [AppIcon, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './setup-step-summary.scss',
  template: `
    @for (group of groups(); track group.title) {
      <section class="env__group">
        <h3 class="env__group-title">{{ group.title }}</h3>
        @if (group.note; as note) {
          <p class="env__group-note">{{ note }}</p>
        }
        <ul class="env__list">
          @for (row of group.rows; track row.id) {
            <li class="env__item" [class]="'env__item--' + row.status">
              <app-icon class="env__mark" [icon]="markOf(row.status)" [size]="1" />
              <span class="env__text">
                <span class="env__name">{{ row.name }}</span>
                <span class="env__detail">{{ row.detail }}</span>
              </span>
              @if (row.stepId; as stepId) {
                <app-button
                  class="env__change"
                  size="small"
                  label="Change"
                  [ariaLabel]="'Change ' + row.name"
                  (click)="wizard.goTo(stepId)"
                />
              }
            </li>
          }
        </ul>
      </section>
    }

    @if (probes.isAvailable) {
      <div class="env__actions">
        <app-button
          label="Check again"
          [loading]="probes.busy()"
          (click)="recheck()"
          tooltip="Run the checks again, after fixing something"
        />
      </div>
    } @else {
      <p class="env__unavailable">
        This machine cannot be checked outside the desktop application.
      </p>
    }
  `,
})
export class SetupStepSummary {
  /**
   * Holds the wizard, exposed for the template's way back to a step.
   */
  protected readonly wizard: SetupWizard = inject(SetupWizard);

  /**
   * Holds the probe client, exposed for the template.
   */
  protected readonly probes: SetupProbes = inject(SetupProbes);

  /**
   * Holds the connection registry, for the AI rows.
   */
  private readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the providers installed plugins contribute.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the plugin client, for the plugin rows.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the settings, for the security and terminal rows.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the security policy, for the image-policy row.
   */
  private readonly security: Security = inject(Security);

  /**
   * Holds the forge client, for the code-hosting rows.
   */
  private readonly forge: Forge = inject(Forge);

  /**
   * Holds every host the installed hosting plugins serve and how each is signed in, or null until
   * they have been read.
   */
  private readonly hostAccounts: WritableSignal<readonly ForgeHostAccount[] | null> = signal<
    readonly ForgeHostAccount[] | null
  >(null);

  /**
   * Gets the AI group: each configuration and whether it answers.
   */
  private readonly aiGroup: Signal<SummaryGroup> = computed((): SummaryGroup => {
    const configured: readonly AiConnection[] = this.connections.connections();
    if (configured.length === 0) {
      return {
        title: 'AI providers',
        rows: [
          {
            id: 'none',
            name: 'No provider configured',
            detail: 'The agent needs one. Install a provider and sign in.',
            status: 'missing',
            stepId: 'agent-harness',
          },
        ],
      };
    }
    return {
      title: 'AI providers',
      rows: configured.map((connection: AiConnection): SummaryRow => {
        const status: AiAuthStatus = this.connections.authStatus(connection.id);
        const page: ProviderPage | undefined = this.providers
          .pages()
          .find((candidate: ProviderPage): boolean => candidate.kinds.includes(connection.kind));
        return {
          id: connection.id,
          name: providerDisplayLabel(
            this.providers.companyFor(connection.kind),
            connection.kind,
            connection.label,
          ),
          detail: status.detail,
          status: status.available ? 'ok' : 'warn',
          stepId: page === undefined ? 'agent-harness' : `agent-harness/${page.id}`,
        };
      }),
    };
  });

  /**
   * Gets the plugins group: what is installed in each category.
   */
  private readonly pluginGroup: Signal<SummaryGroup> = computed((): SummaryGroup => ({
    title: 'Plugins',
    rows: PLUGIN_GROUP_SLOTS.map((slot: PluginSlot): SummaryRow => {
      const names: readonly string[] = this.installedIn(slot);
      return {
        id: slot,
        name: PLUGIN_SLOT_LABELS[slot],
        detail: names.length > 0 ? names.join(', ') : 'None installed',
        status: names.length > 0 ? 'ok' : 'unset',
        stepId: slot,
      };
    }),
  }));

  /**
   * Gets the version-control group: the tool, and who commits are from.
   */
  private readonly versionControlGroup: Signal<SummaryGroup> = computed((): SummaryGroup => {
    const identitySystem: UnkeyedPluginContribution | undefined = this.wizard.identitySystems()[0];
    const identityStep: string =
      identitySystem === undefined ? 'version-control' : `version-control/${identitySystem.id}`;
    const probed: readonly SummaryRow[] = this.probes
      .results()
      .filter((result: SetupProbeResult): boolean => VERSION_CONTROL_PROBES.includes(result.id))
      .map((result: SetupProbeResult): SummaryRow => ({
        id: result.id,
        name: PROBE_LABELS[result.id],
        detail: result.detail,
        status: result.status,
        stepId: result.id === 'git-identity' ? identityStep : 'version-control',
      }));
    return { title: 'Version control', rows: probed };
  });

  /**
   * Gets the code-hosting group: each host the installed hosting plugins serve, and whether it is
   * signed in to (#821). Core names no host, so with no hosting plugin installed there is no group.
   */
  private readonly hostingGroup: Signal<SummaryGroup> = computed((): SummaryGroup => {
    const accounts: readonly ForgeHostAccount[] | null = this.hostAccounts();
    return {
      title: 'Code hosting',
      rows: (accounts ?? []).map((account: ForgeHostAccount): SummaryRow => ({
        id: `${account.pluginId}/${account.host}`,
        name: `${account.provider} (${account.host})`,
        detail: account.status.authenticated
          ? `Signed in${account.status.identity === null ? '' : ` as ${account.status.identity.login}`}`
          : account.status.detail,
        status: account.status.authenticated ? 'ok' : 'unset',
        // No step to change it from: signing in is Settings', and the hosting step only installs.
      })),
    };
  });

  /**
   * Gets the security group: the choices made on the Security step, in the words it offered them.
   */
  private readonly securityGroup: Signal<SummaryGroup> = computed((): SummaryGroup => ({
    title: 'Security',
    rows: [
      // The image policy is the security service's, not a key of the settings store.
      this.choiceRow('security.imagePolicy', this.security.imagePolicy(), 'security'),
      this.choiceRow('ai.permissionPosture', this.settings.aiPermissionPosture(), 'security'),
    ],
  }));

  /**
   * Gets the terminal group: the shells chosen on the Terminal step.
   */
  private readonly terminalGroup: Signal<SummaryGroup> = computed((): SummaryGroup => ({
    title: 'Terminal',
    rows: [
      this.shellRow('terminal.defaultShell', 'System default'),
      this.shellRow('ai.agentShell', 'Default login shell'),
    ],
  }));

  /**
   * Gets the machine group: one toolchain per language Studio supports.
   */
  private readonly machineGroup: Signal<SummaryGroup> = computed((): SummaryGroup => ({
    title: 'This machine',
    note: 'One toolchain per language Studio supports. Anything you do not write in is safe to leave missing.',
    rows: this.probes
      .results()
      .filter((result: SetupProbeResult): boolean => !VERSION_CONTROL_PROBES.includes(result.id))
      .map((result: SetupProbeResult): SummaryRow => ({
        id: result.id,
        name: PROBE_LABELS[result.id],
        detail: result.detail,
        status: result.status,
      })),
  }));

  /**
   * Gets the groups to show, in step order. A group with nothing to say is left out.
   */
  protected readonly groups: Signal<readonly SummaryGroup[]> = computed(
    (): readonly SummaryGroup[] =>
      [
        this.aiGroup(),
        this.pluginGroup(),
        this.versionControlGroup(),
        this.hostingGroup(),
        this.securityGroup(),
        this.terminalGroup(),
        this.machineGroup(),
      ].filter((group: SummaryGroup): boolean => group.rows.length > 0),
  );

  /**
   * Initializes the step, running the machine checks and reading every status it reports. The step
   * is created when the user reaches it, so this is the moment the answer is wanted and the moment it
   * is most likely accurate.
   */
  public constructor() {
    void this.probes.refresh();
    void this.connections.refreshAllAuth();
    void this.readHosts();
  }

  /**
   * Returns the mark shown against a row.
   * @param status The row's status.
   * @returns Returns the icon.
   */
  protected markOf(status: RowStatus): Icon {
    switch (status) {
      case 'ok':
        return Icon.CHECK;
      case 'missing':
        return Icon.SETUP_MISSING;
      case 'unset':
        return Icon.SETUP_NOT_SET;
      default:
        return Icon.SETUP_WARNING;
    }
  }

  /**
   * Runs the checks again, for a user who has just gone and installed something.
   */
  protected recheck(): void {
    void this.probes.refresh();
    void this.connections.refreshAllAuth();
    void this.readHosts();
  }

  /**
   * Reads every host the installed hosting plugins serve, checking each sign-in against its host.
   */
  private async readHosts(): Promise<void> {
    this.hostAccounts.set(await this.forge.hosts());
  }

  /**
   * Lists the names of the plugins installed in a slot.
   * @param slot The slot.
   * @returns Returns the names, in catalogue order.
   */
  private installedIn(slot: PluginSlot): readonly string[] {
    return this.plugins
      .plugins()
      .filter(
        (plugin: PluginSummary): boolean =>
          plugin.state === 'installed' &&
          plugin.contributions.some(
            (contribution: PluginContribution): boolean => contribution.slot === slot,
          ),
      )
      .map((plugin: PluginSummary): string => plugin.name);
  }

  /**
   * Builds a row for a choice setting, in the words its control offered.
   * @param key The setting key, which names the row and its options.
   * @param value The setting's current value.
   * @param stepId The step that changes it.
   * @returns Returns the row.
   */
  private choiceRow(key: string, value: string, stepId: string): SummaryRow {
    const setting: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
    const options: readonly ChoiceOption[] =
      setting !== undefined && 'options' in setting.control ? setting.control.options : [];
    const label: string =
      options.find((option: ChoiceOption): boolean => option.value === value)?.label ?? value;
    return { id: key, name: setting?.title ?? key, detail: label, status: 'ok', stepId };
  }

  /**
   * Builds a row for a shell setting, where the empty string means the default.
   * @param key The setting key.
   * @param fallback What the default is called.
   * @returns Returns the row.
   */
  private shellRow(key: 'terminal.defaultShell' | 'ai.agentShell', fallback: string): SummaryRow {
    const shell: string = this.settings.value(key)();
    return {
      id: key,
      name: SETTINGS_BY_KEY.get(key)?.title ?? key,
      detail: shell === '' ? fallback : shell,
      status: 'ok',
      stepId: 'terminal',
    };
  }
}
