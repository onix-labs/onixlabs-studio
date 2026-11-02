import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { SetupStepCommitIdentity } from '../../../setup-wizard/setup-step-commit-identity';
import { SettingsSection } from '../../settings-section/settings-section';
import { HostingAccounts } from './hosting-accounts/hosting-accounts';
import { VersionControlPlugins } from './version-control-plugins/version-control-plugins';

/**
 * Represents the Version Control section of the settings view: the installed version-control plugins
 * and the program each runs (#817), then every host the installed code-hosting plugins serve and how
 * each is signed in (#821). Core names neither a tool nor a host — both lists come from the plugins.
 */
@Component({
  selector: 'app-source-control-settings',
  imports: [
    Accordion,
    HostingAccounts,
    SettingsSection,
    SetupStepCommitIdentity,
    VersionControlPlugins,
  ],
  templateUrl: './source-control-settings.html',
  styleUrls: ['../section.scss', './source-control-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlSettingsSection {}
