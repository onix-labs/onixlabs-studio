import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { SetupStepCommitIdentity } from '../../../setup-wizard/setup-step-commit-identity';
import { SettingsSection } from '../../settings-section/settings-section';
import { CloneFolder } from './clone-folder/clone-folder';
import { HostingAccounts } from './hosting-accounts/hosting-accounts';
import { VersionControlPlugins } from './version-control-plugins/version-control-plugins';

/**
 * Names the Version Control page to draw: General (fetch, commits, history and the git program),
 * Hosting (the code hosts and how their lists read) or Cloning.
 */
export type SourceControlSettingsView = 'general' | 'hosting' | 'cloning';

/**
 * Represents the Version Control pages of the settings view; the {@link view} input selects which.
 * General holds the registry's fetch, commit and history settings and the program each installed
 * version-control plugin runs (#817); Hosting, every host the installed code-hosting plugins serve and
 * how each is signed in (#821); Cloning, where and how repositories are cloned. Core names neither a
 * tool nor a host — both lists come from the plugins.
 */
@Component({
  selector: 'app-source-control-settings',
  imports: [
    CloneFolder,
    HostingAccounts,
    SettingsSection,
    SetupStepCommitIdentity,
    VersionControlPlugins,
  ],
  templateUrl: './source-control-settings.html',
  styleUrls: ['../section.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlSettingsSection {
  /**
   * Gets the page to draw.
   */
  public readonly view: InputSignal<SourceControlSettingsView> =
    input<SourceControlSettingsView>('general');
}
