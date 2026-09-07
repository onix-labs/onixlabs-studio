import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Icon } from '@shared/angular/icons/icon';
import { Agent, AgentTask } from '@shared/angular/services/agent/agent';

/**
 * The composer's own task indicator: a spinning icon button beside the quick-response button while
 * THIS conversation is running background tasks, opening a drop-up of just those tasks with a stop
 * control on each row. The count is spoken, not shown — it names the tally in the button's tooltip
 * and accessible label, while the face stays a bare spinner like its neighbouring icon buttons.
 *
 * It is the conversation-scoped counterpart of the status strip's app-wide indicator (see
 * `StatusStripTasksMenu`): the strip answers "what is running anywhere?", this answers "what is this
 * agent doing right now?" — so the rows carry no owner name and no reveal control, because the owner
 * is the conversation you are already looking at. Hidden entirely when the agent has nothing running,
 * so the composer stays quiet.
 */
@Component({
  selector: 'app-agent-tasks-menu',
  imports: [Button, AppIcon, CdkMenuTrigger, CdkMenu],
  templateUrl: './agent-tasks-menu.html',
  styleUrl: './agent-tasks-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentTasksMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds this conversation's agent session, provided by the host view's injector.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Gets this conversation's live tasks, as the session reports them.
   */
  protected readonly tasks: Signal<readonly AgentTask[]> = this.agent.tasks;

  /**
   * Gets how many tasks the indicator advertises — ambient housekeeping is listed in the drop-up but
   * never counted, mirroring the status strip's indicator.
   */
  protected readonly count: Signal<number> = computed(
    (): number => this.tasks().filter((task: AgentTask): boolean => !task.skipTranscript).length,
  );

  /**
   * Gets the position that opens the drop-up upward from the trigger, their leading edges aligned —
   * the composer sits at the foot of the panel, so a downward menu would open off the bottom of it.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['up-start'];

  /**
   * Gets the trigger's tooltip and accessible label, naming the count.
   */
  protected readonly triggerTitle: Signal<string> = computed((): string => {
    const running: number = this.count();
    return running === 1 ? '1 background task running' : `${running} background tasks running`;
  });

  /**
   * Asks the provider to stop a task. The harness settles it as `stopped` through the ordinary
   * lifecycle events, so the row leaves the list on its own rather than being removed here.
   * @param task The task to stop.
   */
  protected stop(task: AgentTask): void {
    this.agent.stopTask(task.taskId);
  }

  /**
   * Formats a task's elapsed time coarsely — the drop-up is a progress cue, not a stopwatch.
   * @param durationMs The task's elapsed milliseconds, as last reported.
   * @returns Returns the formatted duration.
   */
  protected elapsed(durationMs: number): string {
    const seconds: number = Math.floor(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes: number = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
  }

  /**
   * Builds the secondary line for a task: what it last did and what it has spent. No owner name, since
   * every row belongs to the conversation the composer is part of.
   * @param task The task to describe.
   * @returns Returns the joined detail, or an empty string when nothing is known yet.
   */
  protected detail(task: AgentTask): string {
    const parts: string[] = [];
    if (task.lastToolName !== undefined) {
      parts.push(task.lastToolName);
    }
    if (task.durationMs > 0) {
      parts.push(this.elapsed(task.durationMs));
    }
    return parts.join(' · ');
  }
}
