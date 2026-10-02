import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AiPermissionPosture } from '@shared/api/ai-types';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { AgentRemoteModal } from '@shared/angular/components/agent-remote-modal/agent-remote-modal';
import { Settings } from '@shared/angular/services/settings/settings';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import {
  MENU_SEPARATOR,
  MenuContribution,
  MenuEntry,
} from '@shared/angular/services/app-menu/app-menu-model';
import { Log } from '@shared/angular/services/log/log';
import {
  MissionControl,
  MissionControlFace,
} from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlWorkItems } from '@features/mission-control/angular/hierarchy/work-items';

/**
 * One of the Permissions group's three buttons: a permission posture, the glyph that stands for it and
 * the short label the button carries.
 */
interface PostureChoice {
  /**
   * Gets the posture the button selects.
   */
  readonly value: AiPermissionPosture;

  /**
   * Gets the button's label.
   */
  readonly label: string;

  /**
   * Gets the button's glyph.
   */
  readonly icon: Icon;
}

/**
 * One of the Show group's buttons: a face of Mission Control.
 */
interface FaceChoice {
  /**
   * Gets the face the button shows.
   */
  readonly value: MissionControlFace;

  /**
   * Gets the button's label.
   */
  readonly label: string;

  /**
   * Gets the button's glyph.
   */
  readonly icon: Icon;
}

/**
 * The faces in ribbon order.
 */
const FACES: readonly FaceChoice[] = [
  { value: 'agents', label: 'Agents', icon: Icon.MISSION_CONTROL_AGENTS },
  { value: 'hierarchy', label: 'Hierarchy', icon: Icon.MISSION_CONTROL_HIERARCHY },
  { value: 'team', label: 'Team', icon: Icon.MISSION_CONTROL_TEAM },
];

/**
 * The permission postures in ribbon order, from the most careful to the most permissive.
 */
const POSTURES: readonly PostureChoice[] = [
  { value: 'prompt', label: 'Prompt All', icon: Icon.PERMISSION_PROMPT },
  { value: 'auto-edits', label: 'Allow Edits', icon: Icon.PERMISSION_EDITS },
  { value: 'auto-all', label: 'Allow All', icon: Icon.PERMISSION_ALL },
];

/**
 * The contextual ribbon shown while the Mission Control tab is active. The Show group switches between
 * Mission Control's faces — the live agents, or the open projects' work-item hierarchy — and the
 * group after it carries the face's own commands. The Agents group acts on every
 * live agent at once through {@link AgentHosts} — currently Stop All, which aborts each running one.
 * The View group resets the column widths and toggles which run states are shown — empty, idle, working
 * — via the shared {@link MissionControl} state.
 *
 * The Permissions group carries everything governing what an agent may do without the user. The global
 * permission posture is drawn as three mutually exclusive toggles rather than a field: one is always
 * pressed, and pressing another moves the posture there. Remote Control sits with them as a permission
 * in its own right — it decides whether a peer elsewhere may answer these prompts — exposing (or
 * ceasing to expose) every remote-capable agent at once; it latches independently of the posture trio.
 */
@Component({
  selector: 'app-mission-control-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    AgentRemoteModal,
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
   * Holds the app-wide live-hosts registry, the source of the running count and of every bulk action.
   */
  private readonly agentHosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the open projects' work items, which the Hierarchy group refreshes.
   */
  private readonly workItems: MissionControlWorkItems = inject(MissionControlWorkItems);

  /**
   * Holds the settings service backing the permission posture.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the faces offered by the Show group, in ribbon order.
   */
  protected readonly faces: readonly FaceChoice[] = FACES;

  /**
   * Gets the face on show.
   */
  protected readonly face: Signal<MissionControlFace> = this.missionControl.face;

  /**
   * Gets whether the hierarchy lists standalone issues.
   */
  protected readonly showStandalone: Signal<boolean> = this.missionControl.showStandalone;

  /**
   * Gets the postures offered by the Permissions group, in ribbon order.
   */
  protected readonly postures: readonly PostureChoice[] = POSTURES;

  /**
   * Gets the number of live hosts whose agent is running, disabling Stop All when none are.
   */
  protected readonly runningCount: Signal<number> = this.agentHosts.runningCount;

  /**
   * Gets how many live agents can be exposed at all, disabling the Remote toggle when none can — and
   * telling the confirmation how many agents answering Yes would act on.
   */
  protected readonly remoteCapableCount: Signal<number> = computed(
    (): number => this.agentHosts.remoteCapableHosts().length,
  );

  /**
   * Gets whether every remote-capable agent is exposed, for the Remote toggle's pressed state.
   */
  protected readonly allRemoteControlled: Signal<boolean> = this.agentHosts.allRemoteControlled;

  /**
   * Holds whether the bulk Remote Control confirmation is open. The toggle never flips on the press
   * itself: exposing every agent at once is confirmed first, as an agent's own toggle is.
   */
  protected readonly remoteConfirmOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the global permission posture, which decides which of the three buttons reads as pressed.
   */
  protected readonly permissionPosture: Signal<AiPermissionPosture> =
    this.settings.aiPermissionPosture;

  /**
   * Gets whether empty agent columns (no conversation) are hidden.
   */
  protected readonly hideEmpty: Signal<boolean> = this.missionControl.hideEmpty;

  /**
   * Gets whether idle agent columns (a settled conversation) are hidden.
   */
  protected readonly hideIdle: Signal<boolean> = this.missionControl.hideIdle;

  /**
   * Gets whether working agent columns (a run in flight) are hidden.
   */
  protected readonly hideWorking: Signal<boolean> = this.missionControl.hideWorking;

  /**
   * Contributes this tab's menu while the Mission Control ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu(
    'mission-control',
    (): readonly MenuContribution[] => [
      {
        id: 'agent',
        label: 'Agents',
        items: [
          {
            id: 'mc.stopAll',
            label: 'Stop All',
            enabled: this.runningCount() > 0,
            run: (): void => this.onStopAll(),
          },
          MENU_SEPARATOR,
          {
            id: 'mc.remoteControl',
            label: 'Remote Control All',
            kind: 'checkbox',
            checked: this.allRemoteControlled(),
            enabled: this.remoteCapableCount() > 0,
            run: (): void => this.onRemoteToggle(),
          },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: [
          ...FACES.map((choice: FaceChoice): MenuEntry => ({
            id: `mc.face.${choice.value}`,
            label: choice.label,
            kind: 'checkbox',
            checked: this.face() === choice.value,
            run: (): void => this.onFace(choice.value),
          })),
          MENU_SEPARATOR,
          {
            id: 'mc.refreshHierarchy',
            label: 'Refresh Hierarchy',
            enabled: this.face() === 'hierarchy',
            run: (): void => this.onRefreshHierarchy(),
          },
          {
            id: 'mc.showStandalone',
            label: 'Show Standalone Issues',
            kind: 'checkbox',
            checked: this.showStandalone(),
            enabled: this.face() === 'hierarchy',
            run: (): void => this.onToggleShowStandalone(),
          },
          MENU_SEPARATOR,
          {
            id: 'mc.hideEmpty',
            label: 'Hide Empty',
            kind: 'checkbox',
            checked: this.hideEmpty(),
            run: (): void => this.onToggleHideEmpty(),
          },
          {
            id: 'mc.hideIdle',
            label: 'Hide Idle',
            kind: 'checkbox',
            checked: this.hideIdle(),
            run: (): void => this.onToggleHideIdle(),
          },
          {
            id: 'mc.hideWorking',
            label: 'Hide Working',
            kind: 'checkbox',
            checked: this.hideWorking(),
            run: (): void => this.onToggleHideWorking(),
          },
          MENU_SEPARATOR,
          { id: 'mc.resetLayout', label: 'Reset Widths', run: (): void => this.onResetLayout() },
        ],
      },
    ],
  );

  /**
   * Shows a face of Mission Control.
   * @param face The face to show.
   */
  protected onFace(face: MissionControlFace): void {
    if (this.missionControl.face() === face) {
      return;
    }
    this.log.info('mission-control.ribbon', 'Face changed', { face });
    this.missionControl.setFace(face);
  }

  /**
   * Re-reads every open project's work-item hierarchy now, rather than at the next poll.
   */
  protected onRefreshHierarchy(): void {
    this.log.info('mission-control.ribbon', 'Refresh hierarchy requested');
    this.workItems.refreshAll();
  }

  /**
   * Toggles whether the hierarchy lists standalone issues.
   */
  protected onToggleShowStandalone(): void {
    const next: boolean = !this.missionControl.showStandalone();
    this.log.info('mission-control.ribbon', 'Toggled Show Standalone', { shown: next });
    this.missionControl.setShowStandalone(next);
  }

  /**
   * Stops every running agent across all live hosts.
   */
  protected onStopAll(): void {
    this.log.info('mission-control.ribbon', 'Stop All requested', { running: this.runningCount() });
    this.agentHosts.stopAll();
  }

  /**
   * Asks whether to expose every remote-capable agent (or stop exposing them), opening the confirmation.
   */
  protected onRemoteToggle(): void {
    this.remoteConfirmOpen.set(true);
  }

  /**
   * Exposes every remote-capable agent, or stops exposing them, the confirmation having been answered
   * Yes. The whole group follows the state the pressed toggle was *not* in, so a partly-exposed set is
   * brought fully on rather than left mixed.
   */
  protected onRemoteConfirmed(): void {
    this.remoteConfirmOpen.set(false);
    const enabled: boolean = !this.allRemoteControlled();
    this.log.info('mission-control.ribbon', 'Remote control set on all agents', {
      enabled,
      agents: this.remoteCapableCount(),
    });
    this.agentHosts.setRemoteControlAll(enabled);
  }

  /**
   * Closes the bulk confirmation unanswered, leaving every agent's Remote Control where it was.
   */
  protected onRemoteDismissed(): void {
    this.remoteConfirmOpen.set(false);
  }

  /**
   * Resets every tile to the default width.
   */
  protected onResetLayout(): void {
    this.log.info('mission-control.ribbon', 'Reset tile layout');
    this.missionControl.resetWidths();
  }

  /**
   * Toggles whether empty agent columns are hidden.
   */
  protected onToggleHideEmpty(): void {
    const next: boolean = !this.missionControl.hideEmpty();
    this.log.info('mission-control.ribbon', 'Toggled Hide Empty', { hidden: next });
    this.missionControl.setHideEmpty(next);
  }

  /**
   * Toggles whether idle agent columns are hidden.
   */
  protected onToggleHideIdle(): void {
    const next: boolean = !this.missionControl.hideIdle();
    this.log.info('mission-control.ribbon', 'Toggled Hide Idle', { hidden: next });
    this.missionControl.setHideIdle(next);
  }

  /**
   * Toggles whether working agent columns are hidden.
   */
  protected onToggleHideWorking(): void {
    const next: boolean = !this.missionControl.hideWorking();
    this.log.info('mission-control.ribbon', 'Toggled Hide Working', { hidden: next });
    this.missionControl.setHideWorking(next);
  }

  /**
   * Moves the global permission posture to the pressed button's. Pressing the posture already in force
   * is a no-op: these behave as radio buttons, so there is no "off" state to fall back to.
   * @param posture The posture the pressed button selects.
   */
  protected onPosture(posture: AiPermissionPosture): void {
    if (this.settings.aiPermissionPosture() === posture) {
      return;
    }
    this.log.info('mission-control.ribbon', 'Permission posture changed', { posture });
    this.settings.setAiPermissionPosture(posture);
  }
}
