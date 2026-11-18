import { ipcRenderer } from 'electron';
import {
  TrustPromptChannel,
  type TrustAnswer,
  type TrustQuestion,
} from '@shared/api/trust-channels';

/**
 * The trust prompt's preload (#1504): the whole of the prompt's behaviour. It fetches the folder being
 * asked about, writes it into the page as text, and sends back which button was pressed. The page runs
 * no script of its own, and nothing is exposed to it: the only thing that can answer is this file,
 * through the two channels the main process accepts from this window alone.
 */
window.addEventListener('DOMContentLoaded', (): void => {
  /**
   * Sends the answer; the main process closes the window once it has it.
   * @param answer The button pressed.
   */
  const answer: (answer: TrustAnswer) => void = (choice: TrustAnswer): void => {
    ipcRenderer.send(TrustPromptChannel.Answer, choice);
  };
  const trust: HTMLElement | null = document.getElementById('trust');
  const restrict: HTMLElement | null = document.getElementById('restrict');
  trust?.addEventListener('click', (): void => answer('trusted'));
  restrict?.addEventListener('click', (): void => answer('restricted'));
  // Escape is the same as Don't Trust, as closing the window is.
  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      answer('restricted');
    }
  });
  void ipcRenderer
    .invoke(TrustPromptChannel.Question)
    .then((question: TrustQuestion | null): void => {
      if (question === null) {
        return;
      }
      const name: HTMLElement | null = document.getElementById('name');
      const folder: HTMLElement | null = document.getElementById('folder');
      if (name !== null) {
        name.textContent = question.name;
      }
      if (folder !== null) {
        folder.textContent = question.folder;
      }
      // The safe choice has the keyboard, so a stray Enter never trusts a folder.
      restrict?.focus();
    });
});
