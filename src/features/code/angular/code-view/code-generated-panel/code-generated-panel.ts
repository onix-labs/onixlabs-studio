import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextEditor } from '@shared/angular/components/text-editor/text-editor';
import { Icon } from '@shared/angular/icons/icon';
import { ASM_LANGUAGE_ID } from '@shared/angular/services/monaco/monaco-asm-language';
import {
  DisasmContent,
  lineForSourceLine,
} from '@shared/angular/services/decoders/listing-content';
import { JitTier } from '@shared/api/jit-capture';
import { GeneratedCode } from '@features/code/angular/generated-code/generated-code';
import { GeneratedCodeState } from '@features/code/angular/generated-code/generated-code-state';

/**
 * Represents the generated-code panel: what the open source file compiles to.
 *
 * Reads the project's build output rather than compiling anything itself — opening a file must not
 * start a build — so what it shows is whatever was last built, and it says so when that is out of date.
 */
@Component({
  selector: 'app-code-generated-panel',
  imports: [TextEditor, AppIcon, Button],
  templateUrl: './code-generated-panel.html',
  styleUrl: './code-generated-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeGeneratedPanel {
  /**
   * Holds the tab's generated code, which outlives the panel.
   */
  private readonly generated: GeneratedCodeState = inject(GeneratedCodeState);

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
   * Emits the listing's editor once it exists.
   */
  public readonly editorCreated: OutputEmitterRef<MonacoApi.editor.ICodeEditor> =
    output<MonacoApi.editor.ICodeEditor>();

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
    contextmenu: false,
    wordWrap: 'off',
    padding: { top: 4 },
  };

  /**
   * Holds the composed read-only editor pane, or undefined before the view initialises.
   */
  private readonly pane: Signal<TextEditor | undefined> = viewChild<TextEditor>(TextEditor);

  /**
   * Gets the resolved outcome, or null before the first resolution completes.
   */
  protected readonly state: Signal<GeneratedCode | null> = this.generated.state;

  /**
   * Gets whether a resolution is in flight.
   */
  protected readonly loading: Signal<boolean> = this.generated.loading;

  /**
   * Gets the rendered listing text and its line map.
   */
  protected readonly content: Signal<DisasmContent> = this.generated.content;

  /**
   * Gets the JIT capture's failure text, when the last capture produced none.
   */
  protected readonly jitError: Signal<string | null> = this.generated.jitError;

  /**
   * Gets whether the captured program had to be stopped before it exited.
   */
  protected readonly jitStopped: Signal<boolean> = this.generated.jitStopped;

  /**
   * Gets which listing is showing: what the compiler produced, or what the JIT did.
   */
  protected readonly mode: Signal<'static' | 'jit'> = this.generated.mode;

  /**
   * Gets the optimisation tier the JIT capture asks for.
   */
  protected readonly tier: Signal<JitTier> = this.generated.tier;

  /**
   * Gets whether a JIT capture is running.
   */
  protected readonly capturing: Signal<boolean> = this.generated.capturing;

  /**
   * Wires the resolve-on-file-change and follow-the-caret effects.
   */
  public constructor() {
    effect((): void => {
      const path: string | null = this.sourcePath();
      untracked((): void => this.generated.show(path));
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
   * Reports the listing's editor and re-applies a pending reveal once it has laid out.
   */
  protected onReady(): void {
    const editor: MonacoApi.editor.ICodeEditor | null = this.pane()?.getEditor() ?? null;
    if (editor !== null) {
      this.editorCreated.emit(editor);
    }
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
   * Switches between the compiler's output and the JIT's, capturing on first switch.
   * @param mode The mode to show.
   */
  protected setMode(mode: 'static' | 'jit'): void {
    this.generated.setMode(mode);
  }

  /**
   * Re-runs the JIT capture, for the tier control and the retry button.
   * @param tier The tier to ask for.
   */
  protected setTier(tier: JitTier): void {
    this.generated.setTier(tier);
  }
}
