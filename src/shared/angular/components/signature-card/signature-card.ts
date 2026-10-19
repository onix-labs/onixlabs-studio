import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { MarkdownRenderer } from '@shared/angular/components/markdown-renderer/markdown-renderer';
import { Icon } from '@shared/angular/icons/icon';
import type { SignatureView } from '@shared/angular/services/autocomplete/signature-content';

/**
 * Draws Studio's signature card (#1021), in place of Monaco's parameter-hints widget: the signature of
 * the function whose arguments are being typed, with the parameter being typed highlighted, its
 * documentation and the function's under it, and — when the function has overloads — which one shows
 * ("1/3") with buttons to step through them (as ↑ and ↓ do).
 *
 * The editor keeps the keyboard, so the card never takes focus: a press on it is kept from moving
 * focus, and its buttons only say which way to step.
 */
@Component({
  selector: 'app-signature-card',
  imports: [Button, MarkdownRenderer],
  templateUrl: './signature-card.html',
  styleUrl: './signature-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'tooltip',
    '(mousedown)': '$event.preventDefault()',
  },
})
export class SignatureCard {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets what the card shows.
   */
  public readonly view: InputSignal<SignatureView> = input.required<SignatureView>();

  /**
   * Raised when the previous overload is asked for.
   */
  public readonly previous: OutputEmitterRef<void> = output<void>();

  /**
   * Raised when the next overload is asked for.
   */
  public readonly next: OutputEmitterRef<void> = output<void>();
}
