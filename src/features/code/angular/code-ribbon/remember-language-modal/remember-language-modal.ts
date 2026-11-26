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
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { RememberLanguageChoice } from './remember-language-choice';
import type { RememberLanguageOffer } from './remember-language-offer';

/**
 * Asks, after the user changes a file's language by hand, whether to remember it (#1068): for this
 * file, for every file with the same ending, or not at all. Dismissing it remembers nothing. The
 * answer is the caller's to act on; the question only reports it.
 */
@Component({
  selector: 'app-remember-language-modal',
  imports: [Button, ButtonRow, Modal, ModalContent],
  templateUrl: './remember-language-modal.html',
  styleUrl: './remember-language-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RememberLanguageModal {
  /**
   * Gets the choices, exposed for the template.
   */
  protected readonly Choice: typeof RememberLanguageChoice = RememberLanguageChoice;

  /**
   * Gets what is offered.
   */
  public readonly offer: InputSignal<RememberLanguageOffer> =
    input.required<RememberLanguageOffer>();

  /**
   * Emitted with the user's answer.
   */
  public readonly chosen: OutputEmitterRef<RememberLanguageChoice> =
    output<RememberLanguageChoice>();

  /**
   * Gets the dialog's accessible label, which also titles its window.
   */
  protected readonly title: string = $localize`:Title of the dialog offering to remember a language chosen by hand:Remember This Language?`;

  /**
   * Gets the question, naming the file and the language.
   */
  protected readonly question: Signal<string> = computed((): string => {
    const offer: RememberLanguageOffer = this.offer();
    const file: string = offer.fileName;
    const language: string = offer.languageName;
    const pattern: string | undefined = offer.extensionPattern;
    return pattern === undefined
      ? $localize`:Asks whether to open a file with no ending in the language just chosen from now on:Open ${file}:file: in ${language}:language: from now on? Studio can remember it for this file.`
      : $localize`:Asks whether to open a file in the language just chosen from now on, for it or every file with its ending:Open ${file}:file: in ${language}:language: from now on? Studio can remember it for this file, or for every ${pattern}:pattern: file.`;
  });

  /**
   * Gets the label of the button remembering it for every file with the same ending, or undefined
   * when the file has no ending.
   */
  protected readonly extensionLabel: Signal<string | undefined> = computed(
    (): string | undefined => {
      const pattern: string | undefined = this.offer().extensionPattern;
      return pattern === undefined
        ? undefined
        : $localize`:Button remembering a language for every file with the same ending:All ${pattern}:pattern: Files`;
    },
  );

  /**
   * Reports an answer.
   * @param choice The user's answer.
   */
  protected choose(choice: RememberLanguageChoice): void {
    this.chosen.emit(choice);
  }
}
