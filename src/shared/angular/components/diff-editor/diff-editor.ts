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
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import { Theme } from '@shared/angular/services/theme/theme';
import { Log } from '@shared/angular/services/log/log';

/**
 * Summarises a computed comparison for whatever chrome reports it.
 */
export interface DiffSummary {
  /**
   * Gets the number of changed regions.
   */
  readonly changes: number;

  /**
   * Gets the number of lines added across those regions.
   */
  readonly linesAdded: number;

  /**
   * Gets the number of lines removed across those regions.
   */
  readonly linesRemoved: number;

  /**
   * Gets the one-based region the caret is in or has last passed, or undefined while it is above the
   * first.
   */
  readonly currentChange: number | undefined;
}

/**
 * Represents the shared diff-editor pane: a single Monaco {@link MonacoApi.editor.IStandaloneDiffEditor}
 * instance comparing an original/modified content pair side by side (or inline). It is the diff sibling
 * of {@link import('@shared/angular/components/text-editor/text-editor').TextEditor} — where that wraps
 * a single editable {@link MonacoApi.editor.IStandaloneCodeEditor}, this wraps the read-only two-model
 * diff editor. It owns the editor instance and only the instance — its creation and disposal, the
 * read-only model pair it rebuilds when the compared content changes, live theme/settings application,
 * and the inline/side-by-side toggle. It has no file header, no change-status badge, and no empty
 * state: a composing feature view supplies those around it by binding the inputs.
 */
@Component({
  selector: 'app-diff-editor',
  templateUrl: './diff-editor.html',
  styleUrl: './diff-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffEditor implements AfterViewInit, OnDestroy {
  /**
   * Holds the Monaco service used to load the engine and resolve options and themes.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Holds the theme service supplying the resolved light/dark mode.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Holds the settings service supplying the font and line-highlight preferences that pick the theme
   * variant.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the content of the diff's original (before) side.
   */
  public readonly original: InputSignal<string> = input<string>('');

  /**
   * Gets the content of the diff's modified (after) side.
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
  private readonly host: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('host');

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
   * Holds the listeners told when the computed diff or the caret moves.
   */
  private readonly summaryListeners: Set<() => void> = new Set<() => void>();

  /**
   * Holds the Monaco subscriptions feeding those listeners, disposed with the editor.
   */
  private readonly subscriptions: MonacoApi.IDisposable[] = [];

  /**
   * Wires effects that rebuild the model pair when the compared content changes, flip the layout when
   * the inline toggle changes, and re-apply the theme when the mode or settings change.
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
      const resolved: TextEditorSettings = this.settings.globalTextEditor();
      if (this.ready) {
        this.monaco
          .getMonaco()
          ?.editor.setTheme(this.monaco.getThemeName(resolved.currentLineHighlight));
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
   * Disposes the editor and both models when the pane is torn down.
   */
  public ngOnDestroy(): void {
    this.log.info('DiffEditor', 'Destroying diff pane');
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
    this.summaryListeners.clear();
    this.editor?.dispose();
    this.editor = null;
    this.originalModel?.dispose();
    this.modifiedModel?.dispose();
    this.originalModel = null;
    this.modifiedModel = null;
    this.ready = false;
  }

  /**
   * Gets the underlying Monaco diff editor instance, or null before creation and after disposal.
   * @returns Returns the diff editor instance, or null.
   */
  public getDiffEditor(): MonacoApi.editor.IStandaloneDiffEditor | null {
    return this.editor;
  }

  /**
   * Gets a summary of the computed comparison: how many regions changed, how many lines that added
   * and removed, and which region the caret is in.
   *
   * Read from Monaco rather than recomputed. Monaco has already diffed these two models — with
   * whatever algorithm and whitespace rules are configured — and a second opinion here would drift
   * from what the user is looking at the moment either of those changed.
   *
   * @returns Returns the summary, empty when no diff has been computed yet.
   */
  public getDiffSummary(): DiffSummary {
    const changes: readonly MonacoApi.editor.ILineChange[] = this.editor?.getLineChanges() ?? [];
    let added: number = 0;
    let removed: number = 0;
    for (const change of changes) {
      // A zero end line is Monaco's way of saying this side of the change has no lines at all: a pure
      // insertion has no original lines, a pure deletion no modified ones.
      if (change.modifiedEndLineNumber > 0) {
        added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
      }
      if (change.originalEndLineNumber > 0) {
        removed += change.originalEndLineNumber - change.originalStartLineNumber + 1;
      }
    }
    return {
      changes: changes.length,
      linesAdded: added,
      linesRemoved: removed,
      currentChange: this.currentChangeOf(changes),
    };
  }

  /**
   * Registers a listener called whenever the computed diff or the caret moves, so an owner can
   * re-read {@link getDiffSummary}.
   *
   * Both matter and for different reasons: the diff changes when the compared content or the options
   * do, and the caret changes which region is being looked at without changing the diff at all.
   *
   * @param listener The listener to call.
   * @returns Returns a disposer that unregisters the listener.
   */
  public onDiffChanged(listener: () => void): () => void {
    this.summaryListeners.add(listener);
    return (): void => {
      this.summaryListeners.delete(listener);
    };
  }

  /**
   * Resolves which changed region the caret is in or has last passed.
   * @param changes The computed line changes, in document order.
   * @returns Returns the one-based index, or undefined while the caret is above the first change.
   */
  private currentChangeOf(changes: readonly MonacoApi.editor.ILineChange[]): number | undefined {
    const line: number | undefined = this.editor?.getModifiedEditor().getPosition()?.lineNumber;
    if (line === undefined || changes.length === 0) {
      return undefined;
    }
    // The last region that starts at or before the caret. Counting from the top rather than testing
    // containment, so a caret in the untouched space between two regions still reports the one it has
    // just read rather than reporting nothing.
    let index: number | undefined;
    for (let position: number = 0; position < changes.length; position++) {
      if (changes[position].modifiedStartLineNumber <= line) {
        index = position + 1;
      }
    }
    return index;
  }

  /**
   * Awaits the Monaco load, then creates the diff editor and seeds it with the current inputs.
   * @returns Returns a promise that resolves once the editor has been created.
   */
  private async initEditor(): Promise<void> {
    await this.monaco.ensureLoaded();
    const monaco: typeof MonacoApi | undefined = this.monaco.getMonaco();
    if (monaco === undefined) {
      this.log.warn('DiffEditor', 'Monaco unavailable; diff editor not created');
      return;
    }

    this.editor = monaco.editor.createDiffEditor(this.host().nativeElement, {
      ...this.monaco.getDiffEditorOptions(),
      renderSideBySide: !this.inline(),
    });

    // The diff is computed asynchronously and recomputed whenever the models or the options change;
    // the caret moves without the diff changing at all. Both alter what the chrome should be saying.
    this.subscriptions.push(
      this.editor.onDidUpdateDiff((): void => this.notifySummary()),
      this.editor.getModifiedEditor().onDidChangeCursorPosition((): void => this.notifySummary()),
    );

    this.ready = true;
    this.log.info('DiffEditor', `Created diff editor for '${this.language()}'`);
    this.setModels(this.original(), this.modified(), this.language());
  }

  /**
   * Tells every listener the summary may have changed.
   */
  private notifySummary(): void {
    for (const listener of this.summaryListeners) {
      listener();
    }
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
}
