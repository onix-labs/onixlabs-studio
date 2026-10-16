import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';

/**
 * The source-control panels' empty state for a repository the user has not trusted: says that version
 * control is switched off in it and offers to trust it. Renders nothing otherwise, so a panel can place
 * it unconditionally above its own content — and nothing at all outside a workspace tab, which has no
 * repository to be restricted.
 */
@Component({
  selector: 'app-repository-restricted',
  imports: [AppIcon, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (restricted()) {
      <div class="repository-restricted">
        <app-icon class="repository-restricted__icon" [icon]="Icon.LOCK" />
        <p class="repository-restricted__text">This repository isn't trusted</p>
        <p class="repository-restricted__hint">
          Studio isn't running version control in this folder. Trust it to see its changes, history
          and branches.
        </p>
        <app-button
          variant="solid"
          [icon]="Icon.LOCK_OPEN"
          label="Trust this repository"
          [disabled]="busy()"
          (click)="trust()"
        />
      </div>
    }
  `,
  styles: [
    `
      // Laid out like the missing-plugin state, so the two "nothing to show, and why" states read the
      // same.
      .repository-restricted {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 2rem 1rem;
        text-align: center;
      }

      .repository-restricted__icon {
        font-size: 2.5rem;
        color: var(--form-muted-foreground-color);
      }

      .repository-restricted__text {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--body-foreground-color);
      }

      .repository-restricted__hint {
        margin: 0 0 0.5rem;
        font-size: 0.85rem;
        color: var(--form-muted-foreground-color);
      }
    `,
  ],
})
export class RepositoryRestricted {
  /**
   * Gets the icon tokens, for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the workspace's version-control binding, which knows whether its repository is restricted;
   * null outside a workspace tab.
   */
  private readonly workspaceGit: WorkspaceGit | null = inject(WorkspaceGit, { optional: true });

  /**
   * Holds whether a trust is in progress.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the workspace's repository is one the user has not trusted.
   */
  protected readonly restricted: Signal<boolean> = computed(
    (): boolean => this.workspaceGit?.isRestricted() ?? false,
  );

  /**
   * Trusts the repository, after which the workspace binds to it and the panels fill.
   */
  protected async trust(): Promise<void> {
    this.busy.set(true);
    try {
      await this.workspaceGit?.trustRepository();
    } finally {
      this.busy.set(false);
    }
  }
}
