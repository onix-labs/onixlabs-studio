import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { Agent, AgentTask } from '@shared/angular/services/agent/agent';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';

/**
 * Shows the active agent conversation's status: a count of the tasks it has running, hidden when there
 * are none.
 *
 * Mounted by the status strip through the active agent view's injector, so it reads that view's own
 * {@link Agent} and is destroyed when another tab is activated. That is why the count lives here rather
 * than in the ambient `StatusBar` registry — the ambient region is for state that is true whichever tab
 * is in front, and a per-conversation count published there would strand itself over the next tab.
 */
@Component({
  selector: 'app-agent-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [trailing]="trailing()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible spacer
  // out in its own flex row, and a shrink-to-fit host would trap the spacer.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentStatusStrip {
  /**
   * Holds the owning view's agent conversation.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Gets the end-aligned segments: how many tasks this conversation has in flight, with their
   * descriptions on the tooltip. Empty when nothing is running, so the strip stays quiet.
   */
  protected readonly trailing: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const running: readonly AgentTask[] = this.agent
        .tasks()
        .filter((task: AgentTask): boolean => !task.skipTranscript);
      if (running.length === 0) {
        return [];
      }
      return [
        {
          id: 'agent-tasks',
          text: `${running.length} ${running.length === 1 ? 'task' : 'tasks'}`,
          icon: Icon.SPINNER,
          title: running.map((task: AgentTask): string => task.description).join('\n'),
        },
      ];
    },
  );
}
