import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import type { AiEditDecision } from '@shared/api/ai-types';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { AgentCard } from '../agent-card/agent-card';
import { AgentChoice, AgentChoiceList } from '../agent-choice-list/agent-choice-list';
import { Chip } from '@shared/angular/components/chip/chip';

/**
 * The choices an edit-decision card offers, in the order they are listed: the plain yes, the yes that
 * stops the asking for the rest of the session, and no. Each carries the sentence that says what
 * choosing it does, so the row reads as a consequence rather than a button label.
 */
const EDIT_DECISION_CHOICES: readonly AgentChoice[] = [
  { value: 'yes', label: 'Yes', description: 'Apply this edit.' },
  {
    value: 'yes-auto',
    label: 'Yes, and automatically accept edits',
    description: 'Apply it, and stop asking for the rest of this session.',
  },
  { value: 'no', label: 'No', description: 'Leave the document as it is.' },
];

/**
 * One run of an edit's summary: plain text, or a signed count to colour by its sign.
 */
export interface DetailSegment {
  /**
   * Gets the text.
   */
  readonly text: string;

  /**
   * Gets whether it is an addition (`+12`), a removal (`−4`), or plain text.
   */
  readonly sign: 'added' | 'removed' | null;
}

/**
 * Matches a signed count in an edit's summary: `+12`, or `−4` with either minus sign.
 */
const SIGNED_COUNT: RegExp = /[+\u2212-]\d[\d,]*/g;

/**
 * Splits an edit's summary (`+3 lines, −120 characters`) into plain text and signed counts.
 * @param detail The summary.
 * @returns Returns its segments, in order.
 */
export function detailSegments(detail: string): readonly DetailSegment[] {
  const segments: DetailSegment[] = [];
  let last: number = 0;
  for (const match of detail.matchAll(SIGNED_COUNT)) {
    const start: number = match.index;
    if (start > last) {
      segments.push({ text: detail.slice(last, start), sign: null });
    }
    segments.push({ text: match[0], sign: match[0].startsWith('+') ? 'added' : 'removed' });
    last = start + match[0].length;
  }
  if (last < detail.length) {
    segments.push({ text: detail.slice(last), sign: null });
  }
  return segments;
}

/**
 * Asks whether to apply an edit the agent made to a document (#855). The choices are a radio list, as
 * the question card draws its suggestions, rather than three stacked buttons: full-width buttons made
 * "No" as loud as "Yes, and automatically accept edits". Choosing a row IS the decision — there is no
 * confirm step, because a decision prompt with a second button to press is two prompts.
 */
@Component({
  selector: 'app-agent-edit-decision-card',
  imports: [Chip, AgentCard, AgentChoiceList],
  templateUrl: './agent-edit-decision-card.html',
  styleUrl: './agent-edit-decision-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentEditDecisionCard {
  /**
   * Gets the edit-decision item.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();

  /**
   * Emits the user's decision.
   */
  public readonly decide: OutputEmitterRef<AiEditDecision> = output<AiEditDecision>();

  /**
   * Gets the choices offered.
   */
  protected readonly choices: readonly AgentChoice[] = EDIT_DECISION_CHOICES;

  /**
   * Gets the summary of the change, its additions and removals marked.
   */
  protected readonly detail: Signal<readonly DetailSegment[]> = computed(
    (): readonly DetailSegment[] => detailSegments(this.item().decisionDetail ?? ''),
  );

  /**
   * Gets the settled state line.
   */
  protected readonly stateLabel: Signal<string> = computed((): string => {
    const item: AgentItem = this.item();
    switch (item.decisionState) {
      case 'applied':
        return item.decisionAuto === true
          ? 'Applied · auto-accepting edits this session'
          : 'Applied';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Not decided';
    }
  });

  /**
   * Decides, from a chosen row.
   * @param value The chosen value.
   */
  protected choose(value: string): void {
    this.decide.emit(value as AiEditDecision);
  }
}
