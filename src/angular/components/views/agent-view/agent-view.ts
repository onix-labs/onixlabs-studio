import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents the AI agent view. This is a placeholder pending the agent chat implementation.
 */
@Component({
  selector: 'app-agent-view',
  imports: [],
  templateUrl: './agent-view.html',
  styleUrl: './agent-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentView {
  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
