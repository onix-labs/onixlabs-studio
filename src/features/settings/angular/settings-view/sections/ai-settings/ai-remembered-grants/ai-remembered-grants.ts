import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { Ai } from '@shared/angular/services/ai/ai';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import type { AiPermissionGrant } from '@shared/api/ai-types';

/**
 * The columns of the grant list.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'permission', header: 'Permission' },
  { id: 'scope', header: 'Scope', width: '30%' },
  { id: 'granted', header: 'Granted', width: '7rem' },
  { id: 'revoke', header: '', width: '5.5rem', align: 'end' },
];

/**
 * What stands in for the date of a grant made before dates were kept, which began in this month.
 */
const BEFORE_THE_RECORD: string = 'Before 2026-11';

/**
 * Represents the list of remembered permissions in the AI settings section (#1164): what the user told
 * a prompt to allow always, or for a workspace, each with Revoke. Those grants let a tool run with no
 * prompt at all, so they must be findable. The list is read when the page opens and after each revoke.
 * Outside Studio (no bridge) it stays empty.
 */
@Component({
  selector: 'app-ai-remembered-grants',
  imports: [Button, SettingRow, Table, TableRowDef],
  templateUrl: './ai-remembered-grants.html',
  styleUrl: './ai-remembered-grants.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiRememberedGrants {
  /**
   * Gets the table's columns.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Holds the AI client the grants are read and revoked through.
   */
  private readonly ai: Ai = inject(Ai);

  /**
   * Holds the notification store, told when a revoke could not be saved.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the grants as last read.
   */
  private readonly grants: WritableSignal<readonly AiPermissionGrant[]> = signal<
    readonly AiPermissionGrant[]
  >([]);

  /**
   * Gets the table's rows, each carrying its grant.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.grants().map((grant: AiPermissionGrant): TableRow => ({
      id: `${grant.workspaceRoot ?? ''}\u0000${grant.key}`,
      data: grant,
    })),
  );

  /**
   * Loads the grants.
   */
  public constructor() {
    void this.load();
  }

  /**
   * Names what a grant covers.
   * @param grant The grant.
   * @returns Returns the tool, and the exact command when it is for one.
   */
  protected describe(grant: AiPermissionGrant): string {
    return grant.command === null ? `${grant.tool} (any use)` : `${grant.tool}: ${grant.command}`;
  }

  /**
   * Names where a grant applies.
   * @param grant The grant.
   * @returns Returns the workspace, or that it applies everywhere.
   */
  protected scope(grant: AiPermissionGrant): string {
    return grant.workspaceRoot ?? 'Everywhere';
  }

  /**
   * Says when a grant was made.
   * @param grant The grant.
   * @returns Returns the date, or that it is older than the record.
   */
  protected granted(grant: AiPermissionGrant): string {
    return grant.grantedAt === null
      ? BEFORE_THE_RECORD
      : new Date(grant.grantedAt).toLocaleDateString();
  }

  /**
   * Revokes a grant, then reads the list again. A revoke that could not be saved still holds until the
   * app restarts, and says so: a user who thinks it has gone must not find it back.
   * @param grant The grant.
   * @returns Resolves once the list is current.
   */
  protected async revoke(grant: AiPermissionGrant): Promise<void> {
    this.log.info('settings.ai', 'Permission grant revoked', grant.tool);
    const saved: boolean | undefined = await this.ai.client?.revokePermissionGrant({
      key: grant.key,
      workspaceRoot: grant.workspaceRoot,
    });
    if (saved === false) {
      this.notifications.notify({
        severity: 'error',
        title: 'The permission could not be revoked for good',
        detail: `${grant.tool} is revoked for now, but it could not be saved and will return when Studio restarts.`,
      });
    }
    await this.load();
  }

  /**
   * Reads the grants (no-op without a bridge).
   * @returns Resolves once they have loaded.
   */
  private async load(): Promise<void> {
    this.grants.set((await this.ai.client?.listPermissionGrants()) ?? []);
  }
}
