import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Log } from '@shared/angular/services/log/log';
import type { GoToMode } from './go-to-model';
import { GoToPresenter } from './go-to-presenter';

/**
 * Describes what the router knows about one Monaco editor beyond the editor itself.
 */
export interface GoToAttachment {
  /**
   * Gets the injector of the component the editor is in, which decides the window the quick-open box
   * is drawn in — a popped-out dock's own, for an editor inside one.
   */
  readonly injector?: Injector | null;
}

/**
 * Routes every Go to Symbol and Go to Line in the application to Studio's own UI (#1009), mirroring
 * the {@link import('@shared/angular/services/find-router/find-router').FindRouter}. Monaco's own
 * quick outline and go to line never answer: their chords are removed, and ⌘⇧O / ⌃G (Ctrl+Shift+O /
 * Ctrl+G) in an editor run Studio's go-to commands, which land here with the focused editor — as do
 * the strip, ribbon and menu Go to items.
 *
 * Editors are attached by the shared text and diff editors, with the injector that places the
 * quick-open box in their window; an editor nobody attached still works, in the main window.
 */
@Service()
export class GoToRouter {
  /**
   * Holds the presenter that asks where to go, the way the user chose.
   */
  private readonly presenter: GoToPresenter = inject(GoToPresenter);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds what is known of each attached editor. Weak, so a disposed editor's entry goes with it.
   */
  private readonly attachments: WeakMap<MonacoApi.editor.ICodeEditor, GoToAttachment> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    GoToAttachment
  >();

  /**
   * Attaches an editor, recording the injector that places its Go to UI.
   * @param editor The Monaco editor.
   * @param attachment What is known of it.
   * @returns Returns a function that detaches the editor.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, attachment: GoToAttachment): () => void {
    this.attachments.set(editor, attachment);
    return (): void => {
      if (this.attachments.get(editor) === attachment) {
        this.attachments.delete(editor);
      }
    };
  }

  /**
   * Opens Go to Symbol or Go to Line for an editor.
   * @param editor The editor to go somewhere in.
   * @param mode What to ask for: a symbol, or a line.
   */
  public open(editor: MonacoApi.editor.ICodeEditor, mode: GoToMode): void {
    this.log.debug('goTo', 'Route Go to', mode);
    this.presenter.present({
      editor,
      mode,
      injector: this.attachments.get(editor)?.injector ?? null,
    });
  }
}
