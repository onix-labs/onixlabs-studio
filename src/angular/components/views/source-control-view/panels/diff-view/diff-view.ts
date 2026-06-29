import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
  viewChild,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import { Monaco } from '../../../../../services/monaco/monaco';
import { GitChangeStatus } from '../../../../../services/repository/repository-data';
import { Settings } from '@shared/angular/services/settings/settings';
import { Theme } from '@shared/angular/services/theme/theme';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Hosts a Monaco diff editor that compares a changed file's before/after content side by side (or
 * inline). This is the application's first use of Monaco's diff editor: the single code editor pages
 * elsewhere use {@link MonacoApi.editor.IStandaloneCodeEditor}, while this builds an
 * {@link MonacoApi.editor.IStandaloneDiffEditor} from two read-only models.
 *
 * The original and modified text arrive as inputs, so the host can swap the compared file by changing
 * bindings; the editor rebuilds its pair of models in response and tracks the active theme.
 */
@Component({
  selector: 'app-diff-view',
  imports: [AppIcon],
  templateUrl: './diff-view.html',
  styleUrl: './diff-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffView implements AfterViewInit, OnDestroy {
  /**
   * Holds the Monaco service used to load the editor and resolve themes.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the theme service supplying the resolved light/dark mode.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the settings service supplying editor preferences (font, line-highlight style).
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the path of the compared file, shown in the header and used as the empty-state trigger (a
   * blank path means no file is selected).
   */
  public readonly fileName: InputSignal<string> = input<string>('');

  /**
   * Gets how the compared file changed, shown as a badge in the header.
   */
  public readonly status: InputSignal<GitChangeStatus | null> = input<GitChangeStatus | null>(null);

  /**
   * Gets the file's content before the change (the diff's original side).
   */
  public readonly original: InputSignal<string> = input<string>('');

  /**
   * Gets the file's content after the change (the diff's modified side).
   */
  public readonly modified: InputSignal<string> = input<string>('');

  /**
   * Gets the Monaco language identifier used to highlight both sides.
   */
  public readonly language: InputSignal<string> = input<string>('plaintext');

  /**
   * Gets a value indicating whether the diff renders inline (unified) rather than side by side.
   */
  public readonly inline: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds a reference to the element Monaco mounts the diff editor into.
   */
  private readonly editorContainer: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('editorContainer');

  /**
   * Holds the Monaco diff editor instance, or null before creation and after disposal.
   */
  private editor: MonacoApi.editor.IStandaloneDiffEditor | null = null;

  /**
   * Holds the original-side model, or null when none is set.
   */
  private originalModel: MonacoApi.editor.ITextModel | null = null;

  /**
   * Holds the modified-side model, or null when none is set.
   */
  private modifiedModel: MonacoApi.editor.ITextModel | null = null;

  /**
   * Holds a value indicating whether the editor is ready for interaction.
   */
  private ready: boolean = false;

  /**
   * Wires effects that rebuild the model pair when the compared file changes, flip the layout when the
   * inline toggle changes, and re-apply the theme when the mode or settings change.
   */
  public constructor() {
    // Rebuild the model pair whenever the compared content or language changes.
    effect((): void => {
      const original: string = this.original();
      const modified: string = this.modified();
      const language: string = this.language();
      if (!this.ready) {
        return;
      }
      this.setModels(original, modified, language);
    });

    // Flip between side-by-side and inline rendering.
    effect((): void => {
      const inline: boolean = this.inline();
      if (this.ready) {
        this.editor?.updateOptions({ renderSideBySide: !inline });
      }
    });

    // Track the active theme (and the font/line-highlight settings that pick the theme variant).
    effect((): void => {
      this.theme.resolvedMode();
      this.settings.globalTextEditor();
      if (this.ready) {
        this.monaco.getMonaco()?.editor.setTheme(this.resolveThemeName());
      }
    });
  }

  /**
   * Loads Monaco if needed and creates the diff editor once the view's element is available.
   */
  public ngAfterViewInit(): void {
    void this.initEditor();
  }

  /**
   * Disposes the editor and both models when the view is torn down.
   */
  public ngOnDestroy(): void {
    this.editor?.dispose();
    this.editor = null;
    this.originalModel?.dispose();
    this.modifiedModel?.dispose();
    this.originalModel = null;
    this.modifiedModel = null;
    this.ready = false;
  }

  /**
   * Awaits the Monaco load, then creates the diff editor and seeds it with the current inputs.
   * @returns Returns a promise that resolves once the editor has been created.
   */
  private async initEditor(): Promise<void> {
    await this.monaco.ensureLoaded();
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      return;
    }

    this.editor = monaco.editor.createDiffEditor(this.editorContainer().nativeElement, {
      theme: this.resolveThemeName(),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: !this.inline(),
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      enableSplitViewResizing: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: this.settings.globalTextEditor().fontSize,
      fontFamily: `"${this.settings.globalTextEditor().fontFamily}", monospace`,
      lineNumbers: 'on',
      padding: { top: 12 },
    });

    this.ready = true;
    this.setModels(this.original(), this.modified(), this.language());
  }

  /**
   * Replaces the diff editor's model pair, disposing the previous models. Skips the work when the
   * editor is not ready.
   * @param original The original-side content.
   * @param modified The modified-side content.
   * @param language The Monaco language identifier for both sides.
   */
  private setModels(original: string, modified: string, language: string): void {
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (this.editor === null || monaco === undefined) {
      return;
    }

    const previousOriginal: MonacoApi.editor.ITextModel | null = this.originalModel;
    const previousModified: MonacoApi.editor.ITextModel | null = this.modifiedModel;

    this.originalModel = monaco.editor.createModel(original, language);
    this.modifiedModel = monaco.editor.createModel(modified, language);
    this.editor.setModel({ original: this.originalModel, modified: this.modifiedModel });

    // Dispose the previous pair only after the new one is attached, so the editor never points at a
    // disposed model.
    previousOriginal?.dispose();
    previousModified?.dispose();
  }

  /**
   * Resolves the Monaco theme name for the active mode and line-highlight style.
   * @returns Returns the registered theme name (for example `onix-dark-outline`).
   */
  private resolveThemeName(): string {
    return this.monaco.getThemeName(this.settings.globalTextEditor().currentLineHighlight);
  }
}
