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
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Says, in one strip, that the repository is stuck in the middle of a merge, rebase, cherry-pick or
 * revert, and offers the three ways out (#1321).
 *
 * A strip rather than a boxed alert: it sits flush under the Commit panel's tool strip, the same
 * height as it, and keeps to one line at any width (#882) — what does not fit is cut off at the end of
 * the text, never wrapped, so the buttons stay where the hand expects them. The warning tint runs edge
 * to edge, hairlines above and below, so it reads as part of the panel's frame rather than a card
 * floating in its content. The longer sentence on what to do next is the text's tooltip and its
 * accessible description, so the strip itself stays one line.
 *
 * Presentational: the panel that owns the repository says what is happening and acts on the buttons.
 */
@Component({
  selector: 'app-operation-strip',
  imports: [AppIcon, Button, TooltipTrigger],
  templateUrl: './operation-strip.html',
  styleUrl: './operation-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    '[attr.aria-label]': 'title()',
    '[attr.aria-description]': 'message()',
  },
})
export class OperationStrip {
  /**
   * Gets what is happening, by name: "Merging topic into main".
   */
  public readonly title: InputSignal<string> = input.required<string>();

  /**
   * Gets how far through the user is — "2 of 5 files resolved" — or null to say nothing.
   */
  public readonly progress: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the sentence on what to do next, shown as the text's tooltip.
   */
  public readonly message: InputSignal<string> = input<string>('');

  /**
   * Gets whether Continue can be pressed: nothing is left conflicted.
   */
  public readonly canContinue: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets whether Skip is offered: only an operation replaying a sequence of commits has a next one.
   */
  public readonly canSkip: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when Continue is pressed.
   */
  public readonly continueClick: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when Skip is pressed.
   */
  public readonly skipClick: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when Abort is pressed.
   */
  public readonly abortClick: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the tooltip on the text: the whole title, which a narrow panel cuts off, and what to do next.
   */
  protected readonly detail: Signal<string> = computed((): string =>
    [this.title(), this.progress(), this.message()]
      .filter((part: string | null): part is string => part !== null && part.length > 0)
      .join('\n'),
  );

  /**
   * Gets Continue's tooltip.
   */
  protected readonly continueTooltip: string = $localize`:Tooltip of the Continue button on the merge or rebase strip:Carry on, now that the conflicts are resolved`;

  /**
   * Gets Skip's tooltip.
   */
  protected readonly skipTooltip: string = $localize`:Tooltip of the Skip button on the rebase strip:Drop the commit this is stuck on and move to the next`;

  /**
   * Gets Abort's tooltip.
   */
  protected readonly abortTooltip: string = $localize`:Tooltip of the Abort button on the merge or rebase strip:Abandon this and put the working tree back where it started`;
}
