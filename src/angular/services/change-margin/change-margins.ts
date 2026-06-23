import { inject, OnDestroy, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Monaco } from '../monaco/monaco';
import {
  ChangeMarginColors,
  ChangeMarginController,
  ChangeMarginOptions,
  DEFAULT_CHANGE_MARGIN_OPTIONS,
} from './change-margin-controller';

/**
 * Names the CSS custom property holding the unsaved (yellow) change colour.
 */
const UNSAVED_COLOR_PROPERTY: string = '--change-margin-unsaved';

/**
 * Names the CSS custom property holding the saved-this-session (green) change colour.
 */
const SAVED_COLOR_PROPERTY: string = '--change-margin-saved';

/**
 * Creates and tracks {@link ChangeMarginController} instances so the change margin can be attached to
 * a Monaco editor with the Monaco namespace and the active theme's colours resolved centrally, and so
 * every controller is torn down when the application shuts down. The component that owns an editor
 * attaches a controller, keeps it, and drives its baselines and disposal from its own lifecycle.
 */
@Service()
export class ChangeMargins implements OnDestroy {
  /**
   * Holds the Monaco service supplying the namespace controllers build decorations with.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the live controllers, so all are disposed if the service is destroyed.
   */
  private readonly controllers: Set<ChangeMarginController> = new Set<ChangeMarginController>();

  /**
   * Attaches a change-margin controller to an editor, resolving the active theme's colours. Returns
   * null when Monaco has not loaded yet, in which case no change margin is drawn.
   * @param editor The editor to draw the change margin for.
   * @param savedContent The document's last-saved content (used as the baseline).
   * @param hasSavedVersion Whether the document has a saved version; when false every line reads as
   * unsaved until the document is first saved.
   * @param options The tuning options; the colours are overridden with the resolved theme colours.
   * @returns Returns the controller, or null when Monaco is unavailable.
   */
  public attach(
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    savedContent: string,
    hasSavedVersion: boolean,
    options: ChangeMarginOptions = DEFAULT_CHANGE_MARGIN_OPTIONS,
  ): ChangeMarginController | null {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return null;
    }
    const controller: ChangeMarginController = new ChangeMarginController(
      monaco,
      editor,
      savedContent,
      hasSavedVersion,
      {
        ...options,
        colors: this.resolveColors(),
      },
    );
    this.controllers.add(controller);
    return controller;
  }

  /**
   * Detaches and disposes a controller previously returned by {@link attach}.
   * @param controller The controller to detach.
   */
  public detach(controller: ChangeMarginController): void {
    if (this.controllers.delete(controller)) {
      controller.dispose();
    }
  }

  /**
   * Resolves the active theme's change-margin colours from the document's CSS custom properties,
   * falling back to the defaults when the properties are not yet available.
   * @returns Returns the resolved overview-ruler colours.
   */
  public resolveColors(): ChangeMarginColors {
    const style: CSSStyleDeclaration = getComputedStyle(document.documentElement);
    const unsaved: string = style.getPropertyValue(UNSAVED_COLOR_PROPERTY).trim();
    const saved: string = style.getPropertyValue(SAVED_COLOR_PROPERTY).trim();
    return {
      unsaved: unsaved === '' ? DEFAULT_CHANGE_MARGIN_OPTIONS.colors.unsaved : unsaved,
      saved: saved === '' ? DEFAULT_CHANGE_MARGIN_OPTIONS.colors.saved : saved,
    };
  }

  /**
   * Disposes every tracked controller when the service is destroyed.
   */
  public ngOnDestroy(): void {
    for (const controller of this.controllers) {
      controller.dispose();
    }
    this.controllers.clear();
  }
}
