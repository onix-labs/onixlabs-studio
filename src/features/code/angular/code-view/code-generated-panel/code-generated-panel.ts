import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { ASM_LANGUAGE_ID } from '@shared/angular/services/monaco/monaco-asm-language';
import {
  buildContent,
  DisasmContent,
  EMPTY_CONTENT,
  lineForSourceLine,
} from '@shared/angular/services/decoders/listing-content';
import {
  GeneratedCode,
  GeneratedCodeResolver,
} from '@features/code/angular/generated-code/generated-code';

/**
 * Represents the generated-code panel: what the open source file compiles to.
 *
 * Reads the project's build output rather than compiling anything itself — opening a file must not
 * start a build — so what it shows is whatever was last built, and it says so when that is out of date.
 */
@Component({
  selector: 'app-code-generated-panel',
  imports: [ToolPanel, TextEditor, AppIcon],
  templateUrl: './code-generated-panel.html',
  styleUrl: './code-generated-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeGeneratedPanel {
  /**
   * Holds the resolver that turns a source path into decoded output.
   */
  private readonly resolver: GeneratedCodeResolver = inject(GeneratedCodeResolver);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the Monaco language identifier for the listing, exposed for the template's binding.
   */
  protected readonly ASM_LANGUAGE_ID: string = ASM_LANGUAGE_ID;

  /**
   * Gets the absolute path of the source file to show generated code for.
   */
  public readonly sourcePath: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the caret's one-based line in the source file, so the listing can follow it.
   */
  public readonly caretLine: InputSignal<number | null> = input<number | null>(null);

  /**
   * Emits when the panel's close button is pressed.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Pins the composed editor to a bare read-only listing viewer, matching the assembly panel.
   */
  protected readonly editorOptions: MonacoApi.editor.IEditorOptions = {
    lineNumbers: 'off',
    minimap: { enabled: false },
    folding: false,
    glyphMargin: false,
    lineDecorationsWidth: 0,
    renderLineHighlight: 'none',
    scrollBeyondLastLine: false,
    contextmenu: false,
    wordWrap: 'off',
    padding: { top: 4 },
  };

  /**
   * Holds the composed read-only editor pane, or undefined before the view initialises.
   */
  private readonly pane: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

  /**
   * Holds the resolved outcome, or null before the first resolution completes.
   */
  protected readonly state: WritableSignal<GeneratedCode | null> = signal<GeneratedCode | null>(
    null,
  );

  /**
   * Holds whether a resolution is in flight, so the panel says so rather than showing a stale answer.
   */
  protected readonly loading: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the rendered listing text and its line map.
   */
  protected readonly content: Signal<DisasmContent> = computed((): DisasmContent => {
    const result: GeneratedCode | null = this.state();
    return result?.kind === 'listing' ? buildContent(result.listing) : EMPTY_CONTENT;
  });

  /**
   * Holds the resolution token, so an answer for a file the user has already navigated away from is
   * discarded rather than shown against the wrong source.
   */
  private token: number = 0;

  /**
   * Wires the resolve-on-file-change and follow-the-caret effects.
   */
  public constructor() {
    effect((): void => {
      const path: string | null = this.sourcePath();
      void this.load(path);
    });

    // Follow the caret: the listing scrolls to the first row generated from the line being edited.
    // One-way here — moving the caret moves the listing, but not the reverse — because a listing that
    // moved the caret while the user was typing would fight them for control of the editor.
    effect((): void => {
      const line: number | null = this.caretLine();
      const content: DisasmContent = this.content();
      if (line === null || content.lines.length === 0) {
        return;
      }
      const target: number | null = lineForSourceLine(content, line);
      if (target !== null) {
        this.pane()?.getEditor()?.revealLineInCenterIfOutsideViewport(target);
      }
    });
  }

  /**
   * Re-applies a pending reveal once the editor has laid out.
   */
  protected onReady(): void {
    const line: number | null = this.caretLine();
    if (line === null) {
      return;
    }
    const target: number | null = lineForSourceLine(this.content(), line);
    if (target !== null) {
      this.pane()?.getEditor()?.revealLineInCenter(target);
    }
  }

  /**
   * Resolves and decodes the generated code for a source file.
   * @param path The source file, or null when there is none.
   */
  private async load(path: string | null): Promise<void> {
    if (path === null) {
      this.state.set(null);
      return;
    }
    const current: number = (this.token += 1);
    this.loading.set(true);
    try {
      const result: GeneratedCode = await this.resolver.resolve(path);
      if (current === this.token) {
        this.state.set(result);
        this.log.debug('code.generated', `Generated code for '${path}': ${result.kind}`);
      }
    } finally {
      if (current === this.token) {
        this.loading.set(false);
      }
    }
  }
}
