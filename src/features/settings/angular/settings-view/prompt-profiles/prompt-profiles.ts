import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { PromptScope } from '@shared/api/ai-types';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { MarkdownField } from '@shared/angular/components/forms/markdown-field/markdown-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import {
  PromptProfile,
  PromptProfiles,
} from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { PromptScopeEditor } from '../prompt-scope-editor/prompt-scope-editor';

/**
 * Edits the user's prompt profiles (#300): standing system and user text, each scoped to surfaces and
 * languages, composed into every matching agent turn. Patterned on the editor's language profiles —
 * an accordion per profile — with the two bodies stacked full-width beneath the scope, because a
 * prompt is a paragraph and a paragraph does not fit in a setting row's control slot.
 */
@Component({
  selector: 'app-prompt-profiles',
  imports: [Accordion, Button, MarkdownField, SettingRow, TextField, Toggle, PromptScopeEditor],
  templateUrl: './prompt-profiles.html',
  styleUrls: ['../sections/section.scss', './prompt-profiles.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptProfilesSettings {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the profiles service.
   */
  private readonly service: PromptProfiles = inject(PromptProfiles);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the profiles, in the user's order.
   */
  protected readonly profiles: Signal<readonly PromptProfile[]> = this.service.profiles;

  /**
   * Holds the identifier of the profile created most recently, so it opens expanded.
   */
  protected readonly justCreated: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Creates a new profile.
   */
  protected add(): void {
    const created: PromptProfile = this.service.create();
    this.justCreated.set(created.id);
    this.log.info('settings.promptProfiles', 'Prompt profile created', created.id);
  }

  /**
   * Deletes a profile.
   * @param id The profile's identifier.
   */
  protected remove(id: string): void {
    this.log.info('settings.promptProfiles', 'Prompt profile deleted', id);
    this.service.delete(id);
  }

  /**
   * Renames a profile. A blank name is kept as it was, because the name heads the profile's section
   * in the composed prompt and a nameless section reads as noise.
   * @param id The profile's identifier.
   * @param name The new name.
   */
  protected rename(id: string, name: string): void {
    const trimmed: string = name.trim();
    if (trimmed.length > 0) {
      this.service.update(id, { name: trimmed });
    }
  }

  /**
   * Sets whether a profile is applied.
   * @param id The profile's identifier.
   * @param enabled Whether it is applied.
   */
  protected setEnabled(id: string, enabled: boolean): void {
    this.service.update(id, { enabled });
  }

  /**
   * Sets a profile's scope.
   * @param id The profile's identifier.
   * @param scope The scope.
   */
  protected setScope(id: string, scope: PromptScope): void {
    this.service.update(id, { scope });
  }

  /**
   * Sets a profile's system text.
   * @param id The profile's identifier.
   * @param system The text.
   */
  protected setSystem(id: string, system: string): void {
    this.service.update(id, { system });
  }

  /**
   * Sets a profile's user text.
   * @param id The profile's identifier.
   * @param user The text.
   */
  protected setUser(id: string, user: string): void {
    this.service.update(id, { user });
  }
}
