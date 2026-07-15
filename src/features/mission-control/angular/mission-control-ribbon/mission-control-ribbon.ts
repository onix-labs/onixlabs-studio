import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiPermissionPosture } from '@shared/api/ai-types';
import {
  AgentRequestEntry,
  AgentRequests,
} from '@shared/angular/services/agent-requests/agent-requests';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripCheck } from '@shared/angular/components/ribbon-strip/ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripRow } from '@shared/angular/components/ribbon-strip/ribbon-strip-row/ribbon-strip-row';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { Settings } from '@shared/angular/services/settings/settings';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';

/**
 * Pairs a permission posture with the short label shown in the ribbon's Policy field.
 */
const POLICY_MODES: readonly { readonly value: AiPermissionPosture; readonly label: string }[] = [
  { value: 'prompt', label: 'Prompt' },
  { value: 'auto-edits', label: 'Auto-allow edits' },
  { value: 'auto-all', label: 'Auto-allow everything' },
];

/**
 * The contextual ribbon shown while the Mission Control tab is active. The Agents group stops every
 * running agent at once ({@link AgentHosts}); the Permissions group answers all pending permission
 * requests in bulk and drives the global policy mode; the View group resets the tile widths and
 * toggles idle-agent columns via the shared {@link MissionControl} state.
 */
@Component({
  selector: 'app-mission-control-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripRow,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripField,
    RibbonStripCheck,
  ],
  templateUrl: './mission-control-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the shared Mission Control state (tile widths, idle toggle).
   */
  private readonly missionControl: MissionControl = inject(MissionControl);

  /**
   * Holds the app-wide live-hosts registry, the source of the running count and the Stop All action.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the app-wide agent-requests registry used for bulk answers.
   */
  private readonly requests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the settings service backing the policy field.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the number of live hosts whose agent is running, disabling Stop All when none are.
   */
  protected readonly runningCount: Signal<number> = this.agentHosts.runningCount;

  /**
   * Gets whether idle agent columns are shown.
   */
  protected readonly showIdle: Signal<boolean> = this.missionControl.showIdle;

  /**
   * Gets the number of pending permission requests, disabling the bulk answers when none are.
   */
  protected readonly pendingPermissions: Signal<number> = computed(
    (): number =>
      this.requests
        .entries()
        .filter((entry: AgentRequestEntry): boolean => entry.item.kind === 'permission').length,
  );

  /**
   * Gets the policy-field options.
   */
  protected readonly policyOptions: readonly string[] = POLICY_MODES.map(
    (mode: { readonly value: AiPermissionPosture; readonly label: string }): string => mode.label,
  );

  /**
   * Gets the label of the current policy mode for the field.
   */
  protected readonly policyLabel: Signal<string> = computed((): string => {
    const current: AiPermissionPosture = this.settings.aiPermissionPosture();
    return (
      POLICY_MODES.find(
        (mode: { readonly value: AiPermissionPosture; readonly label: string }): boolean =>
          mode.value === current,
      )?.label ?? POLICY_MODES[0].label
    );
  });

  /**
   * Stops every running agent across all live hosts.
   */
  protected onStopAll(): void {
    this.agentHosts.stopAll();
  }

  /**
   * Allows every pending permission request across all tabs.
   */
  protected onAllowAll(): void {
    this.answerAll(true);
  }

  /**
   * Denies every pending permission request across all tabs.
   */
  protected onDenyAll(): void {
    this.answerAll(false);
  }

  /**
   * Resets every tile to the default width.
   */
  protected onResetLayout(): void {
    this.missionControl.resetWidths();
  }

  /**
   * Toggles whether idle agent columns are shown.
   * @param value The new checked state.
   */
  protected onShowIdle(value: boolean): void {
    this.missionControl.setShowIdle(value);
  }

  /**
   * Sets the global permission posture from the policy field's chosen label.
   * @param label The chosen policy label.
   */
  protected onPolicy(label: string): void {
    const mode: { readonly value: AiPermissionPosture; readonly label: string } | undefined =
      POLICY_MODES.find(
        (candidate: { readonly value: AiPermissionPosture; readonly label: string }): boolean =>
          candidate.label === label,
      );
    if (mode !== undefined) {
      this.settings.setAiPermissionPosture(mode.value);
    }
  }

  /**
   * Answers every pending permission request, granting or denying each.
   * @param granted Whether to grant.
   */
  private answerAll(granted: boolean): void {
    for (const entry of this.requests.entries()) {
      if (entry.item.kind === 'permission') {
        entry.agent.respondPermission(entry.item, granted);
      }
    }
  }
}
