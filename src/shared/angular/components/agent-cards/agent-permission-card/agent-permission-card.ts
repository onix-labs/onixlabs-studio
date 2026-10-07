import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AgentCard } from '../agent-card/agent-card';

/**
 * How long a grant is remembered beyond this once.
 */
export type PermissionRemember = 'session' | 'workspace' | 'always';

/**
 * Describes the user's answer to a permission prompt.
 */
export interface PermissionAnswer {
  /**
   * Gets whether the user allowed it.
   */
  readonly granted: boolean;

  /**
   * Gets how long the answer is remembered, or undefined for just this once.
   */
  readonly remember?: PermissionRemember;
}

/**
 * Asks the user to allow a tool the agent wants to run (#855): Allow or Deny, with how long to
 * remember the answer.
 */
@Component({
  selector: 'app-agent-permission-card',
  imports: [AgentCard, Button, Dropdown],
  templateUrl: './agent-permission-card.html',
  styleUrl: './agent-permission-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentPermissionCard {
  /**
   * Gets the permission item.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();

  /**
   * Emits the user's answer.
   */
  public readonly respond: OutputEmitterRef<PermissionAnswer> = output<PermissionAnswer>();

  /**
   * Holds how long the answer is to be remembered.
   */
  protected readonly remember: WritableSignal<string> = signal<string>('once');

  /**
   * Gets the remember choices. The workspace one is offered only when the asking run is
   * workspace-scoped.
   */
  protected readonly rememberOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: 'once', label: 'Just this once' },
      { value: 'session', label: 'For this session' },
      ...(this.item().permissionHasWorkspace === true
        ? [{ value: 'workspace', label: 'For this workspace' }]
        : []),
      { value: 'always', label: 'Always' },
    ],
  );

  /**
   * Gets the settled state line, including the remembered scope on a grant.
   */
  protected readonly stateLabel: Signal<string> = computed((): string => {
    const item: AgentItem = this.item();
    if (item.permissionState === 'dismissed') {
      return 'Answered on another device';
    }
    if (item.permissionState !== 'allowed') {
      return 'Denied';
    }
    switch (item.permissionRemember) {
      case 'session':
        return 'Allowed for this session';
      case 'workspace':
        return 'Allowed for this workspace';
      case 'always':
        return 'Always allowed';
      default:
        return 'Allowed';
    }
  });

  /**
   * Answers the prompt, carrying the chosen remember scope.
   * @param granted Whether the user allowed it.
   */
  public answer(granted: boolean): void {
    const scope: string = this.remember();
    this.respond.emit(
      scope === 'session' || scope === 'workspace' || scope === 'always'
        ? { granted, remember: scope }
        : { granted },
    );
  }

  /**
   * Records the remember scope picked.
   * @param scope The scope.
   */
  public setRemember(scope: string): void {
    this.remember.set(scope);
  }
}
