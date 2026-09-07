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
import { Button } from '@shared/angular/components/forms/button/button';
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
import { CodeListing, ListingSection } from '@shared/api/code-listing';
import { JitCaptureResult, JitTier } from '@shared/api/jit-capture';
import { Decoders } from '@shared/angular/services/decoders/decoders';
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
  imports: [ToolPanel, TextEditor, AppIcon, Button],
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
   * Holds the shared decoder client, used here for the JIT capture.
   */
  private readonly decoders: Decoders = inject(Decoders);

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
    if (this.mode() === 'jit') {
      const captured: JitCaptureResult | null = this.jit();
      return captured?.ok === true ? buildContent(captured.listing) : EMPTY_CONTENT;
    }
    const result: GeneratedCode | null = this.state();
    return result?.kind === 'listing' ? buildContent(result.listing) : EMPTY_CONTENT;
  });

  /**
   * Holds the JIT capture's failure text, when the last capture produced none.
   */
  protected readonly jitError: Signal<string | null> = computed((): string | null => {
    const captured: JitCaptureResult | null = this.jit();
    return captured === null || captured.ok ? null : captured.error;
  });

  /**
   * Holds whether the captured program had to be stopped before it exited.
   */
  protected readonly jitStopped: Signal<boolean> = computed((): boolean => {
    const captured: JitCaptureResult | null = this.jit();
    return captured !== null && captured.ok && captured.stopped;
  });

  /**
   * Holds which listing the panel is showing: what the compiler produced, or what the JIT did.
   */
  protected readonly mode: WritableSignal<'static' | 'jit'> = signal<'static' | 'jit'>('static');

  /**
   * Holds the optimisation tier the JIT capture asks for. A control rather than a setting: the same
   * method is markedly different code at each tier.
   */
  protected readonly tier: WritableSignal<JitTier> = signal<JitTier>('full-opts');

  /**
   * Holds the JIT capture's outcome, or null before one has run for this file.
   */
  protected readonly jit: WritableSignal<JitCaptureResult | null> = signal<JitCaptureResult | null>(
    null,
  );

  /**
   * Holds whether a JIT capture is running, which takes seconds rather than milliseconds because it
   * runs the program.
   */
  protected readonly capturing: WritableSignal<boolean> = signal<boolean>(false);

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
   * Switches between the compiler's output and the JIT's, capturing on first switch.
   * @param mode The mode to show.
   */
  protected setMode(mode: 'static' | 'jit'): void {
    this.mode.set(mode);
    if (mode === 'jit' && this.jit() === null) {
      void this.captureJit();
    }
  }

  /**
   * Re-runs the JIT capture, for the tier control and the retry button.
   * @param tier The tier to ask for.
   */
  protected setTier(tier: JitTier): void {
    this.tier.set(tier);
    void this.captureJit();
  }

  /**
   * Runs the program and captures what the JIT generated for this file's methods.
   *
   * Captures everything the JIT compiled and then narrows to the methods this file produced, taken
   * from the static listing — the JIT names methods its own way, and matching on those names is more
   * reliable than trying to express the file's methods as a JitDisasm pattern.
   */
  private async captureJit(): Promise<void> {
    const result: GeneratedCode | null = this.state();
    if (result?.kind !== 'listing') {
      return;
    }
    this.capturing.set(true);
    try {
      const captured: JitCaptureResult = await this.decoders.captureJit(
        result.artifactPath,
        '*',
        this.tier(),
      );
      this.jit.set(
        captured.ok
          ? { ...captured, listing: narrowToMethods(captured.listing, result.listing) }
          : captured,
      );
    } finally {
      this.capturing.set(false);
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
    this.jit.set(null);
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

/**
 * Narrows a JIT listing to the methods a static listing says came from the open file.
 *
 * The JIT names a method `Type:Method(args):ret` while the static listing names it `Type.Method`, so
 * they are compared on the method name alone. Coarse, but the alternative — trusting the JIT to have
 * compiled only what was asked for — is worse: a JitDisasm pattern matches by substring and would
 * quietly include unrelated methods.
 * @param jit The captured JIT listing.
 * @param staticListing The static listing for the open file.
 * @returns Returns the narrowed listing, or the whole capture when nothing matched.
 */
function narrowToMethods(jit: CodeListing, staticListing: CodeListing): CodeListing {
  const wanted: ReadonlySet<string> = new Set<string>(
    staticListing.sections.map((section: ListingSection): string => methodName(section.title)),
  );
  const matched: readonly ListingSection[] = jit.sections.filter(
    (section: ListingSection): boolean => wanted.has(methodName(section.title)),
  );
  // Nothing matched means the JIT compiled none of this file's methods during the run — which is
  // itself worth showing, so the whole capture is kept rather than an empty listing.
  return matched.length === 0 ? jit : { ...jit, sections: matched };
}

/**
 * Extracts a bare method name from either naming convention.
 * @param title The section title.
 * @returns Returns the method name.
 */
function methodName(title: string): string {
  const withoutArgs: string = title.split('(')[0];
  const parts: readonly string[] = withoutArgs.split(/[.:]/);
  return parts[parts.length - 1] ?? withoutArgs;
}
