import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModelManagerView } from '../model-manager-view/model-manager-view';
import { PromptProfilesSection } from '../prompt-profiles/prompt-profiles';
import { SkillLibrarySection } from '../skill-library/skill-library';
import { AiManagerSidebar } from './ai-manager-sidebar';
import { AiManagerSidebarState } from './ai-manager-sidebar-state';

// Test hosts that mount a section beside the AI Manager's sidebar, as the view does, so a spec can
// drive the section through the list and search it now shows in the shared sidebar. Show the
// section on AiManagerNavigation before creating the host, so its accordion is the open one.

/**
 * Hosts the Local Models section with the sidebar.
 */
@Component({
  selector: 'app-models-with-sidebar',
  imports: [AiManagerSidebar, ModelManagerView],
  providers: [AiManagerSidebarState],
  template: '<app-ai-manager-sidebar /><app-model-manager-view [isActive]="true" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelsWithSidebar {}

/**
 * Hosts the Prompt Profiles section with the sidebar.
 */
@Component({
  selector: 'app-profiles-with-sidebar',
  imports: [AiManagerSidebar, PromptProfilesSection],
  providers: [AiManagerSidebarState],
  template: '<app-ai-manager-sidebar /><app-prompt-profiles />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilesWithSidebar {}

/**
 * Hosts the Skills section with the sidebar.
 */
@Component({
  selector: 'app-skills-with-sidebar',
  imports: [AiManagerSidebar, SkillLibrarySection],
  providers: [AiManagerSidebarState],
  template: '<app-ai-manager-sidebar /><app-skill-library />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsWithSidebar {}
