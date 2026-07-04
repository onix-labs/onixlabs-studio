import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { SourceControlCommands } from '@features/repository/angular/source-control-commands/source-control-commands';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';

/**
 * Represents the contextual ribbon shown when a source-control tab is active. Every action is routed
 * through the {@link SourceControlCommands} registry to the active repository view, which forwards it
 * to the repository model (or, for the diff layout toggle, its own state).
 */
@Component({
  selector: 'app-source-control-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripButton],
  templateUrl: './source-control-ribbon.html',
  hostDirectives: [RibbonHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the source-control command registry the ribbon actions are routed through.
   */
  private readonly commands: SourceControlCommands = inject(SourceControlCommands);

  /**
   * Re-reads the repository state.
   */
  protected onRefresh(): void {
    this.commands.refresh();
  }

  /**
   * Fetches from the remote.
   */
  protected onFetch(): void {
    this.commands.fetch();
  }

  /**
   * Pulls the current branch from its upstream.
   */
  protected onPull(): void {
    this.commands.pull();
  }

  /**
   * Pushes the current branch to its upstream.
   */
  protected onPush(): void {
    this.commands.push();
  }

  /**
   * Stages every unstaged change.
   */
  protected onStageAll(): void {
    this.commands.stageAll();
  }

  /**
   * Commits the staged changes.
   */
  protected onCommit(): void {
    this.commands.commit();
  }

  /**
   * Starts a new branch from the current head.
   */
  protected onNewBranch(): void {
    this.commands.newBranch();
  }

  /**
   * Stashes the working-tree changes.
   */
  protected onStash(): void {
    this.commands.stash();
  }

  /**
   * Toggles the diff between side-by-side and inline rendering.
   */
  protected onToggleDiff(): void {
    this.commands.toggleInlineDiff();
  }

  /**
   * Opens the repository's root as a workspace (a new directory tab).
   */
  protected onOpenAsWorkspace(): void {
    this.commands.openAsWorkspace();
  }
}
