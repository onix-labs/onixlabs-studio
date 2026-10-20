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
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AgentCard } from '../agent-card/agent-card';
import { AgentEditDiff } from '../agent-edit-diff/agent-edit-diff';

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
  imports: [AgentCard, AgentEditDiff, Button, ButtonRow, Dropdown],
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
   * Holds whether an answered card shows its change again, having folded it away.
   */
  protected readonly showChange: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Shows or folds away an answered card's change.
   */
  protected toggleChange(): void {
    this.showChange.update((shown: boolean): boolean => !shown);
  }

  /**
   * Gets a path's last segment, which is what names a file in a sentence.
   * @param path The path.
   * @returns Returns the file's name.
   */
  protected fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  /**
   * Holds how long the answer is to be remembered.
   */
  protected readonly remember: WritableSignal<string> = signal<string>('once');

  /**
   * Gets the remember choices, each naming what it remembers (#979). A command tool's longer grants
   * cover the exact command shown, and one whose command cannot be shown whole offers only the
   * session. The workspace choice is offered only when the asking run is workspace-scoped.
   */
  protected readonly rememberOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => {
      const item: AgentItem = this.item();
      const name: string = item.permissionName ?? '';
      const remembers: string = item.permissionRemembers ?? 'tool';
      if (remembers === 'tool') {
        return [
          { value: 'once', label: 'Just this once' },
          { value: 'session', label: `Allow ${name} for this session` },
          ...(item.permissionHasWorkspace === true
            ? [{ value: 'workspace', label: `Allow ${name} in this workspace` }]
            : []),
          { value: 'always', label: `Always allow ${name}` },
        ];
      }
      const session: DropdownOption = {
        value: 'session',
        label: `Allow every ${name} command for this session`,
      };
      if (remembers === 'session') {
        return [{ value: 'once', label: 'Just this once' }, session];
      }
      return [
        { value: 'once', label: 'Just this once' },
        session,
        ...(item.permissionHasWorkspace === true
          ? [{ value: 'workspace', label: 'Allow this command in this workspace' }]
          : []),
        { value: 'always', label: 'Always allow this command' },
      ];
    },
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
    const command: boolean = item.permissionRemembers === 'command';
    switch (item.permissionRemember) {
      case 'session':
        return 'Allowed for this session';
      case 'workspace':
        return command ? 'This command allowed in this workspace' : 'Allowed for this workspace';
      case 'always':
        return command ? 'This command always allowed' : 'Always allowed';
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
