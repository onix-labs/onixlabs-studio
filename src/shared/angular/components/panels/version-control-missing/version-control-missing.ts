import { ChangeDetectionStrategy, Component, inject, signal, WritableSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { VersionControlPrompt } from '@shared/angular/services/plugins/version-control-prompt';

/**
 * The source-control panels' empty state for a repository no installed plugin can read (#818): says
 * what the folder is and offers the plugin that reads it. Renders nothing otherwise, so a panel can
 * place it unconditionally above its own content.
 */
@Component({
  selector: 'app-version-control-missing',
  imports: [AppIcon, Button],
  templateUrl: './version-control-missing.html',
  styleUrl: './version-control-missing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionControlMissing {
  /**
   * Gets the icon tokens, for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the prompt that knows whether a plugin is needed.
   */
  protected readonly prompt: VersionControlPrompt = inject(VersionControlPrompt);

  /**
   * Holds whether an install is in progress.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Installs the plugin the repository needs.
   */
  protected async install(): Promise<void> {
    this.busy.set(true);
    try {
      await this.prompt.install();
    } finally {
      this.busy.set(false);
    }
  }
}
