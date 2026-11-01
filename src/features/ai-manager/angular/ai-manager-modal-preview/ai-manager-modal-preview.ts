import { Service, signal, WritableSignal } from '@angular/core';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import type { AiManagerSection } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import type { SkillImportDraft, SkillImportEntry } from '@shared/api/skill-import-channels';

// ⚠️ TEMPORARY — a design review aid, not a feature. Opens every AI Manager modal with sample data
// from a ribbon menu, so each can be looked at in turn. Nothing it opens writes anything. Delete this
// folder, the ribbon's "Preview (Temporary)" group and the `previewModal` hooks before merging.

/**
 * One modal the preview can open.
 */
export interface ModalPreview {
  /**
   * Gets the preview's id.
   */
  readonly id: string;

  /**
   * Gets the menu label.
   */
  readonly label: string;

  /**
   * Gets the section the modal belongs to, which is shown first.
   */
  readonly section: AiManagerSection;
}

/**
 * Every modal the preview can open, in menu order.
 */
export const MODAL_PREVIEWS: readonly ModalPreview[] = [
  { id: 'skill-delete', label: 'Skills · Delete Skill', section: 'skills' },
  { id: 'skill-improve-review', label: 'Skills · Improve with AI (Review)', section: 'skills' },
  { id: 'profile-delete', label: 'Profiles · Delete Profile', section: 'profiles' },
  { id: 'import-improve', label: 'Import · Improve with AI?', section: 'skills' },
  { id: 'import-repair', label: "Import · Can't Be Imported as It Is", section: 'skills' },
  { id: 'import-working', label: 'Import · Improving with AI', section: 'skills' },
  { id: 'import-failed', label: "Import · The AI Couldn't Do It", section: 'skills' },
  { id: 'import-not-a-skill', label: "Import · The AI Says It Isn't a Skill", section: 'skills' },
  { id: 'import-clash-skill', label: 'Import · Skill Name Clash', section: 'skills' },
  { id: 'import-clash-profile', label: 'Import · Profile Name Clash', section: 'profiles' },
  { id: 'import-committing', label: 'Import · Importing', section: 'skills' },
  { id: 'import-review-improve', label: 'Import · Review the Improvements', section: 'skills' },
  { id: 'import-review-repair', label: 'Import · Review the Conversion', section: 'skills' },
  { id: 'import-summary', label: 'Import · Ready to Import (Summary)', section: 'skills' },
];

/**
 * Carries the preview the ribbon asked for to the section that owns it. The section opens it when it
 * is mounted and clears the request.
 */
@Service()
export class AiManagerModalPreview {
  /**
   * Gets or sets the preview asked for, or null.
   */
  public readonly request: WritableSignal<string | null> = signal<string | null>(null);
}

/**
 * A sample skill for the previews, long enough to scroll.
 * @param name The skill's name.
 * @returns Returns the draft.
 */
export function sampleDraft(name: string = 'account-enumeration'): SkillImportDraft {
  return {
    name,
    description:
      'Account enumeration is when an attacker can tell whether an account exists. Use it when: building login forms; reviewing password reset flows.',
    scope: GLOBAL_SCOPE,
    technologies: [],
    enabled: true,
    body: [
      '# Account Enumeration',
      '',
      'Account enumeration is when an attacker can tell whether a given email, username, or phone number has an account on your system.',
      '',
      '## When to use',
      '',
      '- Login forms and login APIs.',
      '- Password reset and magic-link flows.',
      '',
      '## Core concepts',
      '',
      ...Array.from(
        { length: 40 },
        (_: unknown, index: number): string =>
          `Paragraph ${index + 1} of sample text, so the dialog has something to scroll.`,
      ),
    ].join('\n'),
  };
}

/**
 * A sample import candidate for the previews.
 * @param status Its status.
 * @returns Returns the entry.
 */
export function sampleEntry(status: SkillImportEntry['status'] = 'ready'): SkillImportEntry {
  return {
    source: 'skills/account-enumeration.md',
    status,
    reason: status === 'ready' ? null : 'The file is too short to stand as a skill on its own.',
    draft: sampleDraft(),
    bundled: [],
  };
}
