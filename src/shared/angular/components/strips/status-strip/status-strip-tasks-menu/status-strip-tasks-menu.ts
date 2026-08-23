import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Button } from '@shared/angular/components/forms/button/button';
import { Icon } from '@shared/angular/icons/icon';
import { AgentTasks, LiveAgentTask } from '@shared/angular/services/agent-tasks/agent-tasks';

/**
 * The status strip's agent-task indicator: a count of the work agents are running in the background,
 * opening a drop-up of the live tasks — each naming the conversation running it, what it is doing, and
 * how long it has been going, with controls to reveal that conversation or stop the task.
 *
 * It sits in the ambient region, beside the notification bell, because a backgrounded task outlives
 * both the turn that launched it and the tab it was launched from. An indicator scoped to the active
 * conversation would disappear exactly when it becomes useful — after you have moved on to something
 * else — so the count is app-wide and the row says which agent it belongs to.
 *
 * Hidden entirely when nothing is running, so the strip stays quiet.
 */
@Component({
  selector: 'app-status-strip-tasks-menu',
  imports: [Button, AppIcon, CdkMenuTrigger, CdkMenu],
  templateUrl: './status-strip-tasks-menu.html',
  styleUrl: './status-strip-tasks-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStripTasksMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the app-wide registry of running agent tasks.
   */
  private readonly agentTasks: AgentTasks = inject(AgentTasks);

  /**
   * Gets every live task, newest last, as the registry reports them.
   */
  protected readonly tasks: Signal<readonly LiveAgentTask[]> = this.agentTasks.tasks;

  /**
   * Gets how many tasks the indicator advertises — ambient housekeeping is listed in the flyout but
   * never counted.
   */
  protected readonly count: Signal<number> = this.agentTasks.count;

  /**
   * Gets the position that opens the flyout upward from the trigger, their right edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['up-end'];

  /**
   * Gets the trigger's tooltip and accessible label, naming the count.
   */
  protected readonly triggerTitle: Signal<string> = computed((): string => {
    const running: number = this.count();
    return running === 1 ? '1 agent task running' : `${running} agent tasks running`;
  });

  /**
   * Brings the conversation running a task on screen.
   * @param task The task whose conversation to reveal.
   */
  protected reveal(task: LiveAgentTask): void {
    this.agentTasks.reveal(task);
  }

  /**
   * Asks the provider to stop a task. The harness settles it as `stopped` through the ordinary
   * lifecycle events, so the row leaves the list on its own rather than being removed here.
   * @param task The task to stop.
   */
  protected stop(task: LiveAgentTask): void {
    this.agentTasks.stop(task);
  }

  /**
   * Formats a task's elapsed time coarsely — the flyout is a progress cue, not a stopwatch.
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
   * Builds the secondary line for a task: what it last did and what it has spent.
   * @param task The task to describe.
   * @returns Returns the joined detail, or an empty string when nothing is known yet.
   */
  protected detail(task: LiveAgentTask): string {
    const parts: string[] = [task.ownerTitle];
    if (task.lastToolName !== undefined) {
      parts.push(task.lastToolName);
    }
    if (task.durationMs > 0) {
      parts.push(this.elapsed(task.durationMs));
    }
    return parts.join(' · ');
  }
}
