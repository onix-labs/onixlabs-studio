import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { AiToolPolicy, GateableTool } from '@shared/api/ai-types';
import { GATEABLE_TOOLS } from '@shared/api/ai-types';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * The allow/ask/deny options offered per tool, ordered permissive → restrictive with the default
 * ("Ask") in the middle.
 */
const POLICY_OPTIONS: readonly ButtonGroupOption[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
];

/**
 * Represents the per-tool permission-policy editor embedded in the AI settings section (#309): one row
 * per gateable tool, each with an allow/ask/deny segmented control. The policy the permission gate
 * consults is keyed by the tool's display name; "Ask" (the default) keeps the entry out of the stored
 * map, so it stays sparse.
 */
@Component({
  selector: 'app-ai-tool-policies',
  imports: [ButtonGroup],
  templateUrl: './ai-tool-policies.html',
  styleUrl: './ai-tool-policies.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiToolPolicies {
  /**
   * Gets the gateable tools a policy can be set for.
   */
  protected readonly tools: readonly GateableTool[] = GATEABLE_TOOLS;

  /**
   * Gets the allow/ask/deny options for each row.
   */
  protected readonly policyOptions: readonly ButtonGroupOption[] = POLICY_OPTIONS;

  /**
   * Holds the settings service the policies are read from and written to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets a tool's current policy, defaulting to "ask" when unset.
   * @param tool The tool's display name.
   * @returns Returns the tool's policy.
   */
  protected policyFor(tool: string): AiToolPolicy {
    return this.settings.aiToolPolicies()[tool] ?? 'ask';
  }

  /**
   * Sets a tool's policy.
   * @param tool The tool's display name.
   * @param policy The picked policy value.
   */
  protected setPolicy(tool: string, policy: string): void {
    this.settings.setAiToolPolicy(tool, policy as AiToolPolicy);
  }
}
