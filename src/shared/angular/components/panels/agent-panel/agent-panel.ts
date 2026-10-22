import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';

/**
 * Hosts the agent conversation as a dockable IDE panel. It composes the shared
 * {@link AgentConversationPanel} (strip + chat + history), whose context resolves from the IDE view's
 * provided {@link import('../../../services/agent-conversations/agent-conversation-context').AGENT_CONVERSATION_CONTEXT}
 * resolver (workspace or repository). The dock chrome supplies the title bar.
 *
 * Runs on the `workspace` surface (#713): the model is told it stands in a workspace with a well
 * beside it, may read the focused document and open files into the well, and is offered none of the
 * editor's edit tools — a workspace conversation has no document of its own to act on.
 */
@Component({
  selector: 'app-agent-panel',
  imports: [AgentConversationPanel],
  templateUrl: './agent-panel.html',
  styleUrl: './agent-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentPanel {
  /**
   * Gets the dock panel descriptor this body renders. Supplied by the dock outlet, which sets it on
   * every projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the dock state, read to find the group this panel sits in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock's focus tracker, which names the group the user last opened, revealed or pressed.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the auto-hide controller, which names the collapsed group currently peeking out.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

  /**
   * Gets whether the prompt should have focus: this panel is its group's showing tab and the group is
   * the focused one (opened, revealed or pressed), or its collapsed group is peeking out. A panel in no
   * group is floating or popped out, alone in its own window, so it always is. Merely being docked
   * somewhere when the workspace opens is not enough — that would take focus from the well.
   */
  protected readonly promptFocus: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), id);
    if (stack === null) {
      return true;
    }
    if (stack.active !== id) {
      return false;
    }
    return stack.collapsed === true
      ? this.autoHide.flyoutStackId() === stack.id
      : this.dockFocus.focusedStackId() === stack.id;
  });
}
